import Foundation

/// Anonymous, consent-gated product telemetry for the menu bar app.
///
/// The macOS twin of `windows/src-tauri/src/telemetry.rs`: same endpoint, same
/// `app.name`, same event names, same sanitizer, same day granularity, so the
/// two trays land in one table and separate on `app.platform`.
///
/// Privacy invariants (enforced here, not by the caller):
///
/// - Nothing is sent while the toggle is off. When the desktop app's own state
///   file exists, its decision and its install id are used and this app never
///   writes that file: one decision covers both, and the two apps' events join
///   on one id. Standalone, the decision lives in this app's own defaults and
///   defaults off for EU / EEA / UK / CH and for an unknown region.
/// - The only identifier is a random id minted locally. Switching the toggle
///   off mints a fresh one so past and future data cannot be linked.
/// - Events carry a day-granularity date only, and every prop goes through the
///   whitelist sanitizer below. No paths, no session content, no exact amounts.
/// - Debug builds and `swift run` never send (`CODEBURN_TELEMETRY_DEV=1`
///   overrides, for end-to-end testing).

// MARK: - JSON

/// Enough of a JSON value to carry the CLI's `telemetrySnapshot` block from the
/// payload decoder to the wire without this app knowing — or re-deriving —
/// anything about what is in it.
enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let value = try? container.decode(Bool.self) { self = .bool(value); return }
        if let value = try? container.decode(Int.self) { self = .int(value); return }
        if let value = try? container.decode(Double.self) { self = .double(value); return }
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode([JSONValue].self) { self = .array(value); return }
        self = .object(try container.decode([String: JSONValue].self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

// MARK: - Consent

enum TelemetryConsentSource: String, Sendable {
    /// The desktop app decided, and this app is only reading its answer.
    case desktop
    /// A standalone menu bar install, which decides for itself.
    case app
}

struct TelemetryConsent: Equatable, Sendable {
    let source: TelemetryConsentSource
    let installID: String
    let enabled: Bool
    /// Only the desktop app asks a consent question, so only its answer can be
    /// pending. A standalone install's region default *is* its decision, which
    /// is why nothing gates on this when `source` is `.app`.
    let onboarded: Bool

    var canTrack: Bool {
        switch source {
        case .desktop: enabled && onboarded
        case .app: enabled
        }
    }
}

/// The desktop app's `telemetry.v1.json`, of which only these three fields
/// matter here. Read-only, always: that app owns the file and rewrites it whole.
struct DesktopTelemetryState: Equatable, Sendable {
    let installID: String
    let enabled: Bool
    let onboarded: Bool
}

// MARK: - The queue

struct TelemetryEvent: Codable, Equatable, Sendable {
    let name: String
    let day: String
    let props: [String: JSONValue]
}

private struct TelemetryEnvelope: Encodable {
    struct App: Encodable {
        let name: String
        let version: String
        let platform: String
        let arch: String
        let country: String?
    }

    let schema: Int
    let installId: String
    let app: App
    let events: [TelemetryEvent]
}

enum TelemetryPostOutcome: Sendable {
    case sent
    /// A 4xx: this batch will never be accepted.
    case rejected
    /// A 5xx, a timeout or no network: worth another beat.
    case retry
}

protocol TelemetryTransport: Sendable {
    func post(
        _ body: Data,
        to endpoint: URL,
        timeout: TimeInterval,
        completion: @escaping @Sendable (TelemetryPostOutcome) -> Void
    )
}

struct URLSessionTelemetryTransport: TelemetryTransport {
    func post(
        _ body: Data,
        to endpoint: URL,
        timeout: TimeInterval,
        completion: @escaping @Sendable (TelemetryPostOutcome) -> Void
    ) {
        var request = URLRequest(url: endpoint, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        URLSession.shared.dataTask(with: request) { _, response, _ in
            guard let status = (response as? HTTPURLResponse)?.statusCode else {
                completion(.retry)
                return
            }
            if (200..<300).contains(status) {
                completion(.sent)
            } else if (400..<500).contains(status) {
                completion(.rejected)
            } else {
                completion(.retry)
            }
        }.resume()
    }
}

/// What the Privacy section renders. `source` decides whether the toggle is
/// live or a readout of the desktop app's decision.
struct TelemetryStatus: Equatable, Sendable {
    let enabled: Bool
    let source: TelemetryConsentSource
}

// MARK: - The client

@MainActor
final class Telemetry {
    /// The app's instance. A build that can never send has no business reading
    /// the desktop app's state file either, which is also what keeps `swift run`
    /// and `swift test` away from it — the suites inject their own everything.
    static let shared = Telemetry(
        desktopStateURL: defaultMaySend() ? defaultDesktopStateURL : nil
    )

    static let endpoint = URL(string: "https://api.codeburn.app/v1/telemetry")!
    static let schema = 1
    /// What separates these rows from the desktop app's (`codeburn-desktop`).
    static let appName = "codeburn-menubar"
    static let releaseBundleID = "org.agentseal.codeburn-menubar"

    /// EU-27 + EEA (IS, LI, NO) + UK + CH: the conservative "default off"
    /// region. Copied from `app/electron/telemetry.ts`; the suite asserts the
    /// two lists are still the same set.
    static let defaultOffCountries: Set<String> = [
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
        "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
        "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
    ]

    /// Every event this app may send. An unknown name is dropped rather than
    /// forwarded, so a typo at a call site cannot invent a metric.
    static let eventNames: Set<String> = [
        "app_open", "app_close", "popover_open", "settings_open", "update_click",
        "glance_open", "dock_enabled", "dock_disabled", "dock_provider_switch",
        "dock_drag_end", "usage_snapshot",
    ]

    static let maxQueue = 200
    static let maxString = 64
    static let maxArray = 12
    static let maxKeys = 16
    /// How deep a container may sit below the props object. The daily usage
    /// snapshot is the deepest shape either app sends: props -> models[] ->
    /// model -> tasks[] -> task. Anything deeper is dropped whole.
    static let maxDepth = 5
    /// Belt and braces on top of the per-level caps.
    static let maxLeaves = 1_000

    static let httpTimeout: TimeInterval = 10
    /// Quit waits for the last batch, so it gets a timeout nobody would notice.
    static let quitTimeout: TimeInterval = 1.5

    static let enabledKey = "CodeBurnTelemetryEnabled"
    static let installIDKey = "CodeBurnTelemetryInstallId"
    static let lastSnapshotDayKey = "CodeBurnTelemetryLastSnapshotDay"

    private let defaults: UserDefaults
    private let desktopStateURL: URL?
    private let country: String?
    private let appVersion: String
    private let endpoint: URL
    private let transport: TelemetryTransport
    /// False in a debug build or a `swift run`: the queue still fills, so the
    /// wiring can be exercised, but nothing leaves the machine.
    private let maySend: Bool
    private let now: @Sendable () -> Date

    private var consent: TelemetryConsent
    private var queue: [TelemetryEvent] = []
    private var openedAt: Date
    private var flushing = false
    /// Consecutive failed sends, which is what the beat's backoff is computed
    /// from, and how many beats are still owed to it.
    private var failures = 0
    private var beatsOwed = 0
    private var flushBeat: NSBackgroundActivityScheduler?

    init(
        defaults: UserDefaults = .standard,
        desktopStateURL: URL? = Telemetry.defaultDesktopStateURL,
        region: String? = Locale.current.region?.identifier,
        appVersion: String = AppVersion.normalizedBundleShortVersion,
        endpoint: URL = Telemetry.endpoint,
        transport: TelemetryTransport = URLSessionTelemetryTransport(),
        maySend: Bool = Telemetry.defaultMaySend(),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.defaults = defaults
        self.desktopStateURL = desktopStateURL
        self.country = Telemetry.normalizedCountry(region)
        self.appVersion = appVersion
        self.endpoint = endpoint
        self.transport = transport
        self.maySend = maySend
        self.now = now
        self.openedAt = now()
        self.consent = Telemetry.resolveConsent(
            desktop: Telemetry.readDesktopState(at: desktopStateURL),
            defaults: defaults,
            country: Telemetry.normalizedCountry(region)
        )
        if consent.source == .app {
            defaults.set(consent.installID, forKey: Telemetry.installIDKey)
        }
    }

    // MARK: Environment

    /// `~/Library/Application Support/codeburn-desktop/telemetry.v1.json`, which
    /// is Electron's `userData` for that app (its package name) plus the file
    /// name its Telemetry class writes.
    static var defaultDesktopStateURL: URL? {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("codeburn-desktop")
            .appendingPathComponent("telemetry.v1.json")
    }

    /// Mirrors the desktop app's "packaged only" rule with this app's
    /// equivalent: a release build running out of the signed bundle.
    static func defaultMaySend(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
        if environment["CODEBURN_TELEMETRY_DEV"] == "1" { return true }
        #if DEBUG
        return false
        #else
        return Bundle.main.bundleIdentifier == releaseBundleID
        #endif
    }

    /// Only a two-letter alpha region is a country here, so the UN M.49 forms
    /// (`419`) come back as unknown rather than as a country nobody can join on.
    static func normalizedCountry(_ region: String?) -> String? {
        guard let region, region.count == 2,
              region.allSatisfy({ $0.isASCII && $0.isLetter }) else { return nil }
        return region.uppercased()
    }

    /// An unknown region is the conservative case and defaults off, exactly as
    /// the desktop does.
    static func defaultEnabled(for country: String?) -> Bool {
        guard let country else { return false }
        return !defaultOffCountries.contains(country.uppercased())
    }

    // MARK: Consent

    /// A version this build does not understand, a missing id or a missing
    /// toggle all mean "the desktop app has not decided", which sends the
    /// resolution on to this app's own defaults rather than guessing on the
    /// desktop app's behalf.
    static func parseDesktopState(_ data: Data) -> DesktopTelemetryState? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["version"] as? Int == 1,
              let installID = root["installId"] as? String, !installID.isEmpty,
              let enabled = root["enabled"] as? Bool else { return nil }
        let onboardedAt = root["onboardedAt"] as? String
        return DesktopTelemetryState(
            installID: installID,
            enabled: enabled,
            onboarded: !(onboardedAt ?? "").isEmpty
        )
    }

    static func readDesktopState(at url: URL?) -> DesktopTelemetryState? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return parseDesktopState(data)
    }

    /// The one decision every send is gated on. A valid desktop file wins
    /// outright, so a menu bar app running beside the desktop app never asks its
    /// own question.
    static func resolveConsent(
        desktop: DesktopTelemetryState?,
        defaults: UserDefaults,
        country: String?
    ) -> TelemetryConsent {
        if let desktop {
            return TelemetryConsent(
                source: .desktop,
                installID: desktop.installID,
                enabled: desktop.enabled,
                onboarded: desktop.onboarded
            )
        }
        let stored = defaults.string(forKey: installIDKey)
        return TelemetryConsent(
            source: .app,
            installID: (stored?.isEmpty == false ? stored : nil) ?? UUID().uuidString,
            enabled: defaults.object(forKey: enabledKey) as? Bool
                ?? defaultEnabled(for: country),
            onboarded: true
        )
    }

    /// Re-reads the desktop app's file, because it can appear or change while
    /// this app runs: the desktop app can be installed after the menu bar app,
    /// and its consent screen is answered in a different process.
    @discardableResult
    private func reresolve() -> TelemetryConsent {
        var fresh = Telemetry.resolveConsent(
            desktop: Telemetry.readDesktopState(at: desktopStateURL),
            defaults: defaults,
            country: country
        )
        // A defaults write that did not land leaves this app's id unstored, and
        // resolving would mint a fresh one every time it is asked. Keep the one
        // this run already has.
        if fresh.source == .app, consent.source == .app,
           defaults.string(forKey: Telemetry.installIDKey) == nil {
            fresh = TelemetryConsent(
                source: .app,
                installID: consent.installID,
                enabled: fresh.enabled,
                onboarded: true
            )
        }
        consent = fresh
        return fresh
    }

    func status() -> TelemetryStatus {
        let consent = reresolve()
        return TelemetryStatus(enabled: consent.enabled, source: consent.source)
    }

    /// The settings toggle. Off mints a fresh install id and empties the queue,
    /// so nothing already recorded is sent and nothing later can be tied to what
    /// came before. Refused while the desktop app is the source: its file is
    /// that app's to write.
    func setEnabled(_ enabled: Bool) {
        guard reresolve().source == .app else { return }
        defaults.set(enabled, forKey: Telemetry.enabledKey)
        if !enabled {
            queue.removeAll()
            defaults.set(UUID().uuidString, forKey: Telemetry.installIDKey)
        }
        reresolve()
    }

    // MARK: Sanitizing

    /// Whitelist sanitizer. Keeps short strings, finite numbers and booleans,
    /// plus objects and arrays of them nested up to `maxDepth`, each level
    /// capped by `maxKeys` / `maxArray` and the whole event by `maxLeaves`.
    /// Everything else is dropped. Port of `sanitizeProps` in the desktop app.
    static func sanitizeProps(_ props: JSONValue) -> [String: JSONValue] {
        guard case .object(let fields) = props else { return [:] }
        var budget = maxLeaves
        return sanitizeObject(fields, depth: 1, budget: &budget)
    }

    private static func sanitizeObject(
        _ fields: [String: JSONValue],
        depth: Int,
        budget: inout Int
    ) -> [String: JSONValue] {
        var out: [String: JSONValue] = [:]
        // Sorted so the key cap keeps the same sixteen keys the Windows tray
        // does, whose serde map is likewise ordered by key.
        for key in fields.keys.sorted() {
            if out.count >= maxKeys { break }
            guard let clean = sanitizeValue(fields[key]!, depth: depth, budget: &budget) else {
                continue
            }
            out[truncate(key)] = clean
        }
        return out
    }

    private static func sanitizeValue(
        _ value: JSONValue,
        depth: Int,
        budget: inout Int
    ) -> JSONValue? {
        switch value {
        case .null:
            return nil
        case .bool, .int:
            guard budget > 0 else { return nil }
            budget -= 1
            return value
        case .double(let number):
            guard budget > 0, number.isFinite else { return nil }
            budget -= 1
            return value
        case .string(let text):
            guard budget > 0 else { return nil }
            budget -= 1
            return .string(truncate(text))
        case .array(let entries):
            // Only leaves are allowed at the bottom; a container here is dropped
            // whole rather than truncated to something that reads complete.
            guard depth < maxDepth else { return nil }
            var items: [JSONValue] = []
            for entry in entries.prefix(maxArray) {
                if let clean = sanitizeValue(entry, depth: depth + 1, budget: &budget) {
                    items.append(clean)
                }
            }
            return items.isEmpty ? nil : .array(items)
        case .object(let fields):
            guard depth < maxDepth else { return nil }
            let flat = sanitizeObject(fields, depth: depth + 1, budget: &budget)
            return flat.isEmpty ? nil : .object(flat)
        }
    }

    private static func truncate(_ text: String) -> String {
        String(text.prefix(maxString))
    }

    // MARK: Tracking

    /// `YYYY-MM-DD` in the machine's own timezone, the desktop app's day key.
    static func dayKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// Queues one event. An unknown name, junk props or a withheld decision are
    /// all dropped here rather than reaching the wire.
    func track(_ name: String, _ props: JSONValue = .object([:])) {
        guard Telemetry.eventNames.contains(name), consent.canTrack else { return }
        // The oldest event gives way at the cap, so the queue always carries the
        // most recent window rather than freezing at whatever filled it first.
        if queue.count >= Telemetry.maxQueue { queue.removeFirst() }
        queue.append(TelemetryEvent(
            name: name,
            day: Telemetry.dayKey(now()),
            props: Telemetry.sanitizeProps(props)
        ))
    }

    /// The CLI's daily aggregate, forwarded verbatim and at most once a day. The
    /// desktop app sends the same block from its own process when it is the one
    /// that decided, and two apps sending it under one install id would double
    /// every figure in it.
    func trackUsageSnapshot(_ snapshot: JSONValue?) {
        guard let snapshot, case .object = snapshot else { return }
        guard consent.canTrack, consent.source == .app else { return }
        let day = Telemetry.dayKey(now())
        guard defaults.string(forKey: Telemetry.lastSnapshotDayKey) != day else { return }
        defaults.set(day, forKey: Telemetry.lastSnapshotDayKey)
        track("usage_snapshot", snapshot)
    }

    /// Session length, in whole minutes, for the last flush before the process
    /// goes.
    func trackClose() {
        let minutes = Int((now().timeIntervalSince(openedAt) / 60).rounded())
        track("app_close", .object(["sessionMinutes": .int(minutes)]))
    }

    // MARK: Flushing

    /// The flush beat, hung off the same background-activity scheduler the
    /// refresh backstop uses: coalescible, tolerant, and no new fast timer in an
    /// app that is measured on idle energy.
    func start() {
        track("app_open")
        guard flushBeat == nil else { return }
        let scheduler = NSBackgroundActivityScheduler(
            identifier: "\(Telemetry.releaseBundleID).telemetry")
        scheduler.repeats = true
        scheduler.interval = 300
        scheduler.tolerance = 60
        scheduler.qualityOfService = .background
        scheduler.schedule { [weak self] completion in
            Task { @MainActor in
                self?.runFlushBeat()
                completion(.finished)
            }
        }
        flushBeat = scheduler
    }

    /// Beats to sit out after `failures` consecutive failed sends: the Windows
    /// tray's doubling backoff, in five-minute beats and capped at half an hour,
    /// so an endpoint that has been down all day is still asked twice an hour.
    static func beatsToSkip(failures: Int) -> Int {
        guard failures > 0 else { return 0 }
        return min(1 << min(failures - 1, 8), 6) - 1
    }

    func runFlushBeat() {
        if beatsOwed > 0 {
            beatsOwed -= 1
            return
        }
        flush()
    }

    /// Best-effort batch POST. A 4xx drops the batch, because retrying a payload
    /// the server has already refused would wedge the queue at its cap; a 5xx or
    /// a dead network keeps it for the next beat.
    func flush() {
        // Also where a decision made elsewhere is picked up: the desktop app can
        // be installed, or answer its consent screen, while this app is running.
        reresolve()
        guard maySend, !flushing, let (body, batch) = makeBatch() else { return }
        flushing = true
        transport.post(body, to: endpoint, timeout: Telemetry.httpTimeout) { [weak self] outcome in
            Task { @MainActor in
                self?.settle(outcome, batch: batch)
            }
        }
    }

    /// The last flush, on the way out. Bounded so quitting never waits on a slow
    /// network, and never restored: the process is going either way.
    func flushOnQuit(timeout: TimeInterval = Telemetry.quitTimeout) {
        trackClose()
        reresolve()
        guard maySend, let (body, _) = makeBatch() else { return }
        let done = DispatchSemaphore(value: 0)
        transport.post(body, to: endpoint, timeout: timeout) { _ in done.signal() }
        _ = done.wait(timeout: .now() + timeout)
    }

    private func makeBatch() -> (Data, [TelemetryEvent])? {
        guard consent.canTrack, !queue.isEmpty else { return nil }
        let batch = queue
        let envelope = TelemetryEnvelope(
            schema: Telemetry.schema,
            installId: consent.installID,
            app: TelemetryEnvelope.App(
                name: Telemetry.appName,
                version: appVersion,
                platform: "darwin",
                arch: Telemetry.arch,
                country: country
            ),
            events: batch
        )
        guard let body = try? JSONEncoder().encode(envelope) else { return nil }
        queue.removeAll()
        return (body, batch)
    }

    private func settle(_ outcome: TelemetryPostOutcome, batch: [TelemetryEvent]) {
        flushing = false
        switch outcome {
        case .sent, .rejected:
            // The endpoint answered, so it is up: only a refused payload is
            // gone, and the next batch is a different payload.
            failures = 0
            beatsOwed = 0
        case .retry:
            // Back in front of whatever was queued while the batch was out.
            queue = Array((batch + queue).suffix(Telemetry.maxQueue))
            failures += 1
            beatsOwed = Telemetry.beatsToSkip(failures: failures)
        }
    }

    private static var arch: String {
        #if arch(arm64)
        "arm64"
        #else
        "x64"
        #endif
    }

    /// Visible for tests.
    var queuedEvents: [TelemetryEvent] { queue }
}
