import Foundation
import Testing
@testable import CodeBurnMenubar

/// The language switch is applied in-process (#1219 follow-up). It used to
/// restart the app, and macOS resets the "access data from other apps" consent
/// every time a process goes, so a Warp user was re-prompted on every change.
/// What these tests pin is the part that made the restart unnecessary: the
/// `.lproj` sub-bundle `L(_:)` reads from is chosen explicitly, for "System"
/// included, so nothing depends on CFBundle's launch-time pick.
@Suite("Runtime language switch", .serialized)
struct LocalizationSwitchTests {
    private static let shipped = L10n.supportedLocalizations

    @Test("an explicit language names its own table")
    func explicitLanguage() {
        #expect(L10n.language(for: .french, available: Self.shipped, development: "en", systemPreferred: ["ja-JP"]) == "fr")
        #expect(L10n.language(for: .chineseTraditional, available: Self.shipped, development: "en", systemPreferred: []) == "zh-Hant")
        #expect(L10n.language(for: .english, available: Self.shipped, development: "en", systemPreferred: ["fr-FR"]) == "en")
    }

    @Test("a language the bundle does not ship falls back to the development language")
    func unshippedLanguage() {
        #expect(L10n.language(for: .korean, available: ["en", "fr"], development: "en", systemPreferred: ["ko-KR"]) == "en")
    }

    @Test("System follows the OS order", arguments: [
        (["fr-FR", "en-US"], "fr"),
        (["en-GB", "fr-FR"], "en"),
        (["ja-JP"], "ja"),
        (["ko-KR"], "ko"),
        (["zh-Hans-CN"], "zh-Hans"),
        (["zh-Hant-TW", "zh-Hans-CN"], "zh-Hant"),
        // Nothing in common: the development language, which is the key text.
        (["de-DE"], "en"),
        ([], "en"),
    ])
    func systemFollowsTheOS(preferences: [String], expected: String) {
        #expect(L10n.language(for: .system, available: Self.shipped, development: "en", systemPreferred: preferences) == expected)
    }

    @Test("every shipped language resolves to its own lproj")
    func everyShippedLanguageResolves() throws {
        for preference in LanguagePreference.allCases where preference != .system {
            let resolved = L10n.subbundle(for: preference, in: L10n.bundle, systemPreferred: [])
            #expect(resolved != L10n.bundle, "\(preference.rawValue) did not resolve to a sub-bundle")
            // SwiftPM lowercases the directory it writes, so compare that way.
            #expect(resolved.bundlePath.lowercased().hasSuffix("/\(preference.rawValue.lowercased()).lproj"))
        }
    }

    @Test("a bundle with no lproj at all still answers, in the key's own English")
    func missingLprojFallsBackToTheBundle() throws {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("CodeBurnMenubarTests.\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let empty = try #require(Bundle(path: directory.path))
        let resolved = L10n.subbundle(for: .french, in: empty, systemPreferred: ["fr-FR"])
        #expect(resolved == empty)
        #expect(resolved.localizedString(forKey: "Refresh Now", value: "Refresh Now", table: L10n.table) == "Refresh Now")
    }

    @Test("a key with no translation renders as its English self")
    func missingKeyFallsBackToEnglish() {
        let french = L10n.subbundle(for: .french, in: L10n.bundle, systemPreferred: [])
        let absent = "codeburn.test.key.that.is.not.in.any.table"
        #expect(french.localizedString(forKey: absent, value: absent, table: L10n.table) == absent)
        #expect(french.localizedString(forKey: "Refresh Now", value: "Refresh Now", table: L10n.table) == "Actualiser maintenant")
    }

    @Test("the switch changes what L() answers with, in this process")
    func switchesWithoutRestart() {
        let restore = LanguagePreference.current()
        defer { L10n.use(restore) }

        L10n.use(.french)
        let french = L("Refresh Now")
        L10n.use(.japanese)
        let japanese = L("Refresh Now")
        // The two Chinese tables are the ones a case-mismatched lproj lookup
        // drops to English without saying anything.
        L10n.use(.chineseSimplified)
        let simplified = L("Refresh Now")
        L10n.use(.chineseTraditional)
        let traditional = L("Refresh Now")
        L10n.use(.english)
        let english = L("Refresh Now")

        #expect(french == "Actualiser maintenant")
        #expect(japanese == "今すぐ更新")
        #expect(simplified == "立即刷新")
        #expect(traditional == "立即重新整理")
        // English is the development language, so the key is its own copy.
        #expect(english == "Refresh Now")
    }

    @Test("a format string switches with everything else")
    func formatStringsSwitchToo() {
        let restore = LanguagePreference.current()
        defer { L10n.use(restore) }

        L10n.use(.french)
        let french = L("%lld%% left", 42)
        L10n.use(.english)
        #expect(french == "42% restant")
        #expect(L("%lld%% left", 42) == "42% left")
    }
}
