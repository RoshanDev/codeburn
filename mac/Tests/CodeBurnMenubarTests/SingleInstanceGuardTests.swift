import Foundation
import Testing
@testable import CodeBurnMenubar

@Suite("Single instance guard")
struct SingleInstanceGuardTests {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func decide(_ running: [(pid: pid_t, launchDate: Date?)], own: pid_t) -> SingleInstanceGuard.Decision {
        SingleInstanceGuard.decide(running: running, ownPID: own, ownLaunchDate: now)
    }

    /// The same call from a copy whose own launch date macOS will not report.
    private func decideWithoutOwnDate(_ running: [(pid: pid_t, launchDate: Date?)], own: pid_t) -> SingleInstanceGuard.Decision {
        SingleInstanceGuard.decide(running: running, ownPID: own, ownLaunchDate: nil)
    }

    private func retires(_ decision: SingleInstanceGuard.Decision, _ pid: pid_t) -> Bool {
        guard case .retire(let pids) = decision else { return false }
        return pids.contains(pid)
    }

    @Test("the newest launch retires every other copy")
    func newestRetiresTheRest() {
        let decision = decide([
            (pid: 10, launchDate: now.addingTimeInterval(-60)),
            (pid: 11, launchDate: now),
            // No launch date reported: treated as older, since a copy that
            // predates ours is the only way to lose that field in practice.
            (pid: 13, launchDate: nil),
            (pid: 99, launchDate: now),
        ], own: 99)
        #expect(decision == .retire([10, 11, 13]))
    }

    @Test("a copy that launched later wins, and this one stands down")
    func yieldsToNewer() {
        let running: [(pid: pid_t, launchDate: Date?)] = [
            (pid: 12, launchDate: now.addingTimeInterval(60)),
            (pid: 99, launchDate: now),
        ]
        #expect(decide(running, own: 99) == .yieldToNewer)
    }

    @Test("our own process is never retired, however its launch date reads")
    func neverRetiresSelf() {
        #expect(decide([(pid: 99, launchDate: now.addingTimeInterval(-60))], own: 99) == .retire([]))
    }

    // Two login items firing at once is how a user ends up with two flames:
    // with only "retire what is strictly older" both copies found nothing to
    // retire and both stayed up. Exactly one side of the tie must survive.
    @Test("two simultaneous launches leave exactly one instance")
    func simultaneousLaunchesLeaveOne() {
        let both: [(pid: pid_t, launchDate: Date?)] = [(pid: 1, launchDate: now), (pid: 2, launchDate: now)]
        #expect(decide(both, own: 1) == .yieldToNewer)
        #expect(decide(both, own: 2) == .retire([1]))
    }

    @Test("a peer whose launch date is unreadable is left alone, and does not outrank us, when its pid is higher")
    func unreadableDateHigherPIDIsLeftAlone() {
        let running: [(pid: pid_t, launchDate: Date?)] = [(pid: 100, launchDate: nil), (pid: 99, launchDate: now)]
        #expect(decide(running, own: 99) == .retire([]))
    }

    @Test("a peer whose launch date is unreadable is still retired when its pid is lower")
    func unreadableDateLowerPIDIsRetired() {
        let running: [(pid: pid_t, launchDate: Date?)] = [(pid: 13, launchDate: nil), (pid: 99, launchDate: now)]
        #expect(decide(running, own: 99) == .retire([13]))
    }

    // Each copy sees its own launch date and reads the other's as nil. Both sides asking
    // the other to go is the one answer that is never allowed: it leaves no menu bar at all.
    @Test("neither side of a launch-date disagreement can be the one that goes")
    func disagreementNeverLeavesZero() {
        func bothSurvivable(low: SingleInstanceGuard.Decision, high: SingleInstanceGuard.Decision) -> Bool {
            let lowQuits = low == .yieldToNewer || retires(high, 1)
            let highQuits = high == .yieldToNewer || retires(low, 2)
            return !(lowQuits && highQuits)
        }
        #expect(bothSurvivable(
            low: decide([(pid: 1, launchDate: now), (pid: 2, launchDate: nil)], own: 1),
            high: decide([(pid: 1, launchDate: nil), (pid: 2, launchDate: now)], own: 2)
        ))
        // And when neither can even read its own date.
        let blind: [(pid: pid_t, launchDate: Date?)] = [(pid: 1, launchDate: nil), (pid: 2, launchDate: nil)]
        #expect(bothSurvivable(
            low: decideWithoutOwnDate(blind, own: 1),
            high: decideWithoutOwnDate(blind, own: 2)
        ))
    }
}
