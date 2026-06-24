import AppKit
import SwiftUI

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    var popover: NSPopover?
    var usageStore = UsageStore()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem?.button {
            if let icon = NSImage(named: "MenuBarIcon") {
                icon.isTemplate = true   // adapts to light/dark menu bar
                icon.size = NSSize(width: 18, height: 18)
                button.image = icon
            } else {
                button.title = "⬡"
            }
            button.action = #selector(togglePopover)
            button.target = self
        }

        let contentView = ContentView().environmentObject(usageStore)
        popover = NSPopover()
        popover?.contentSize = NSSize(width: 320, height: 400)
        popover?.behavior = .transient
        popover?.contentViewController = NSHostingController(rootView: contentView)

        usageStore.refresh()
        startTimer()
    }

    @objc func togglePopover() {
        guard let button = statusItem?.button else { return }
        if let popover, popover.isShown {
            popover.performClose(nil)
        } else {
            popover?.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func startTimer() {
        Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: true) { [weak self] _ in
            self?.usageStore.refresh()
        }
    }
}
