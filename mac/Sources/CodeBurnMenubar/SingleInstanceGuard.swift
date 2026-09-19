import AppKit

/// Keeps exactly one copy of the app running.
///
/// A second copy is not a harmless duplicate the way a second text editor is:
/// each one puts its own flame in the menu bar and pins its own Capacity Dock
/// to a screen edge. Two copies are easy to end up with — `~/Applications`
/// (where `codeburn menubar` installs) and `/Applications` (a copy dragged out
/// of a download, or Finder's "Keep Both") are separate bundle paths, so the
/// system starts each as its own process and each registers its own login
/// item, which is how both come up at once at login.
///
/// One instance wins outright. Asking only *strictly older* copies to go left
/// two simultaneous launches each finding nothing older than itself, and both
/// stayed up. The winner is the newest launch — the right way round while
/// developing, and what a self-relaunch needs (`AppRelaunch`) — with ties
/// broken on pid so both sides of a tie pick the same winner.
///
/// "Keep Both" is Finder's copy dialog, not a setting this app stores: it is a
/// choice about files on disk, and this is about processes. `--keep-both` on
/// the command line opts a single launch out of the guard, for the one case
/// where running two on purpose is the point.
enum SingleInstanceGuard {
    /// Opt out for one launch: `open -n CodeBurnMenubar.app --args --keep-both`.
    static let keepBothFlag = "--keep-both"

    /// Grace period before an instance that ignored `terminate()` is killed.
    private static let forceTerminateDelay: Duration = .seconds(3)

    enum Decision: Equatable {
        /// This instance is the one that stays; the older copies are asked to go.
        case retire([pid_t])
        /// A newer copy is already up, so this one goes instead.
        case yieldToNewer
    }

    static func decide(
        running: [(pid: pid_t, launchDate: Date?)],
        ownPID: pid_t,
        ownLaunchDate: Date?
    ) -> Decision {
        // A peer whose launch date macOS does not report only counts — to be retired
        // as much as to outrank us — when its pid is lower than ours. Ranking it as
        // oldest unconditionally let two copies that each read the other's date as nil
        // both call themselves newest, and each retired the other: zero left.
        let others = running.filter { $0.pid != ownPID && ($0.launchDate != nil || $0.pid < ownPID) }
        // Our own date unreadable means we cannot claim to be newest at all, so retire
        // lower pids only and stand down for nobody: the side with the higher pid keeps
        // the field, and a disagreement leaves one copy up rather than none.
        guard let ownLaunchDate else {
            return .retire(running.filter { $0.pid < ownPID }.map(\.pid))
        }
        let outranked = others.contains { ($0.launchDate ?? .distantPast, $0.pid) > (ownLaunchDate, ownPID) }
        return outranked ? .yieldToNewer : .retire(others.map(\.pid))
    }

    /// False when this launch has stood down for a copy that is already up, in
    /// which case the caller must stop setting the app up.
    @MainActor
    static func enforceSingleInstance() -> Bool {
        guard !CommandLine.arguments.contains(keepBothFlag) else { return true }
        let peers = runningPeers()
        let decision = decide(
            running: peers.map { (pid: $0.processIdentifier, launchDate: $0.launchDate) },
            ownPID: ProcessInfo.processInfo.processIdentifier,
            ownLaunchDate: NSRunningApplication.current.launchDate
        )
        guard case .retire(let doomed) = decision else {
            NSLog("CodeBurn: a newer instance is already running - quitting this one")
            NSApp.terminate(nil)
            return false
        }
        let victims = peers.filter { doomed.contains($0.processIdentifier) }
        guard !victims.isEmpty else { return true }

        for victim in victims {
            NSLog("CodeBurn: retiring older instance (pid %d)", victim.processIdentifier)
            // A polite terminate lets the older copy tear its dock windows down
            // and release its status item; forceTerminate is only for a copy
            // that never answers.
            if !victim.terminate() { victim.forceTerminate() }
        }
        Task { @MainActor in
            try? await Task.sleep(for: forceTerminateDelay)
            for victim in victims where !victim.isTerminated {
                NSLog("CodeBurn: older instance (pid %d) ignored terminate - forcing", victim.processIdentifier)
                victim.forceTerminate()
            }
        }
        return true
    }

    /// Every running copy of this app, matched on the executable as well as on
    /// the bundle id: a bundle whose Info.plist identity did not survive its
    /// install is missing from `runningApplications(withBundleIdentifier:)`
    /// entirely, and that copy is exactly the zombie flame nothing could retire.
    private static func runningPeers() -> [NSRunningApplication] {
        let identifier = Bundle.main.bundleIdentifier
        let executable = Bundle.main.executableURL?.lastPathComponent
        return NSWorkspace.shared.runningApplications.filter { app in
            if let identifier, app.bundleIdentifier == identifier { return true }
            return executable != nil && app.executableURL?.lastPathComponent == executable
        }
    }
}
