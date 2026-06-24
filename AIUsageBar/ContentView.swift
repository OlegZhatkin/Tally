import SwiftUI

// MARK: - Design tokens

enum Brand {
    static let claude   = Color(red: 0.85, green: 0.46, blue: 0.34) // #D97757
    static let chatgpt  = Color(red: 0.06, green: 0.64, blue: 0.50) // #10A37F
    static let weekAll  = Color(red: 0.11, green: 0.62, blue: 0.46) // #1D9E75
    static let sonnet   = Color(red: 0.21, green: 0.54, blue: 0.87) // #378ADD

    static let cardBG   = Color.primary.opacity(0.04)
    static let track    = Color.primary.opacity(0.10)

    /// Brand colour of a Claude metric, chosen by its label.
    static func metricColor(_ label: String) -> Color {
        let l = label.lowercased()
        if l.contains("session") { return claude }
        if l.contains("all")     { return weekAll }
        if l.contains("sonnet") || l.contains("scoped") || l.contains("opus") { return sonnet }
        return claude
    }

    /// Fill state overrides the base colour at high utilisation.
    static func fillColor(_ base: Color, fraction: Double) -> Color {
        if fraction > 0.95 { return .red }
        if fraction > 0.80 { return .orange }
        return base
    }
}

// MARK: - Root

struct ContentView: View {
    @EnvironmentObject var store: UsageStore
    @State private var selectedTab = 0
    @State private var showDebug = false
    @State private var refreshSpin = 0.0

    private var accent: Color { selectedTab == 0 ? Brand.claude : Brand.chatgpt }
    private var serviceName: String { selectedTab == 0 ? "Claude" : "ChatGPT" }
    private var serviceSymbol: String { selectedTab == 0 ? "sparkles" : "bubble.left.fill" }
    private var currentDebug: String {
        selectedTab == 0 ? store.claude.debugRaw : store.chatgpt.debugRaw
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            tabs

            ScrollView {
                VStack(spacing: 14) {
                    if selectedTab == 0 {
                        ClaudeView()
                    } else {
                        ChatGPTView()
                    }
                    if showDebug {
                        DebugPanel(raw: currentDebug)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 14)
                .padding(.bottom, 8)
                .animation(.easeInOut(duration: 0.2), value: selectedTab)
            }

            footer
        }
        .frame(width: 340, height: 460)
        .background(Color(NSColor.windowBackgroundColor))
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 11) {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(accent)
                .frame(width: 30, height: 30)
                .overlay(
                    Image(systemName: serviceSymbol)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                )

            Text(serviceName)
                .font(.system(size: 18, weight: .medium))
                .foregroundColor(.primary)

            Spacer()

            Button {
                withAnimation(.easeInOut(duration: 0.5)) { refreshSpin += 360 }
                store.refresh()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.secondary)
                    .rotationEffect(.degrees(refreshSpin))
            }
            .buttonStyle(.plain)
            .help("Обновить")
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }

    // MARK: Tabs

    private var tabs: some View {
        HStack(spacing: 8) {
            PillTab(title: "Claude", isActive: selectedTab == 0, color: Brand.claude) {
                withAnimation(.easeInOut(duration: 0.2)) { selectedTab = 0 }
            }
            PillTab(title: "ChatGPT", isActive: selectedTab == 1, color: Brand.chatgpt) {
                withAnimation(.easeInOut(duration: 0.2)) { selectedTab = 1 }
            }
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 4)
    }

    // MARK: Footer

    private var footer: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.5)
            HStack {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { showDebug.toggle() }
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "magnifyingglass")
                        Text("Debug")
                    }
                    .font(.system(size: 11))
                    .foregroundColor(showDebug ? .primary : .secondary)
                }
                .buttonStyle(.plain)

                Spacer()
                Text("Обновляется каждые 15 мин")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                Spacer()

                Button("Выйти") { NSApplication.shared.terminate(nil) }
                    .font(.system(size: 11))
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
    }
}

// MARK: - Pill tab

struct PillTab: View {
    let title: String
    let isActive: Bool
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(isActive ? .white : .secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(isActive ? color : Color.primary.opacity(0.06))
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Metric card

struct MetricCard: View {
    let bar: UsageBar
    let index: Int

    @State private var shown = false

    private var fraction: Double { min(max(bar.percent, 0), 1) }
    private var pct: Int { Int((bar.percent * 100).rounded()) }
    private var base: Color { Brand.metricColor(bar.label) }
    private var color: Color { Brand.fillColor(base, fraction: fraction) }
    private var isHigh: Bool { fraction > 0.80 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(bar.label)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.primary)
                Spacer()
                HStack(spacing: 4) {
                    if isHigh {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 11))
                    }
                    Text("\(pct)%")
                        .font(.system(size: 13, weight: .semibold).monospacedDigit())
                }
                .foregroundColor(color)
            }

            // Progress bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Brand.track)
                    Capsule()
                        .fill(color)
                        .frame(width: max(4, geo.size.width * (shown ? fraction : 0)))
                }
            }
            .frame(height: 9)
            .padding(.top, 10)

            if !bar.resetAt.isEmpty {
                HStack(spacing: 5) {
                    Image(systemName: "clock")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                    Text(bar.resetAt)
                        .font(.system(size: 12))
                        .foregroundColor(Color.secondary.opacity(0.8))
                }
                .padding(.top, 9)
            }
        }
        .padding(14)
        .background(Brand.cardBG, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .opacity(shown ? 1 : 0)
        .offset(y: shown ? 0 : 8)
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.8)
                .delay(Double(index) * 0.05)) {
                shown = true
            }
        }
    }
}

// MARK: - Claude tab

struct ClaudeView: View {
    @EnvironmentObject var store: UsageStore

    var body: some View {
        let usage = store.claude
        if usage.isLoading {
            LoadingCard()
        } else if !usage.isLoggedIn {
            NotLoggedInCard(service: "Claude", accent: Brand.claude, symbol: "sparkles") {
                store.openClaudeLogin()
            }
        } else if let err = usage.error, usage.bars.isEmpty {
            ErrorCard(message: err)
        } else if usage.bars.isEmpty {
            EmptyCard()
        } else {
            ForEach(Array(usage.bars.enumerated()), id: \.offset) { idx, bar in
                MetricCard(bar: bar, index: idx)
            }
        }
    }
}

// MARK: - ChatGPT tab

struct ChatGPTView: View {
    @EnvironmentObject var store: UsageStore

    var body: some View {
        let usage = store.chatgpt
        if usage.isLoading {
            LoadingCard()
        } else if !usage.isLoggedIn {
            NotLoggedInCard(service: "ChatGPT", accent: Brand.chatgpt, symbol: "bubble.left.fill") {
                store.openChatGPTLogin()
            }
        } else if let err = usage.error {
            ErrorCard(message: err)
        } else {
            PlanCard(name: usage.planName, status: usage.planStatus)
        }
    }
}

// MARK: - Cards: plan / states

struct PlanCard: View {
    let name: String
    let status: String
    @State private var shown = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Тарифный план")
                    .font(.system(size: 14, weight: .semibold))
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(Brand.chatgpt)
                        .frame(width: 30, height: 30)
                        .overlay(
                            Image(systemName: "bubble.left.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(.white)
                        )
                    Text(name.isEmpty ? "—" : name)
                        .font(.system(size: 16, weight: .semibold))
                    Spacer()
                }
                if !status.isEmpty {
                    Text(status)
                        .font(.system(size: 12))
                        .foregroundColor(Color.secondary.opacity(0.8))
                }
            }

            Divider().opacity(0.5)

            Text("ChatGPT не предоставляет API с остатком лимитов, поэтому показывается только план подписки.")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Brand.cardBG, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .opacity(shown ? 1 : 0)
        .offset(y: shown ? 0 : 8)
        .onAppear { withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) { shown = true } }
    }
}

struct LoadingCard: View {
    var body: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text("Загрузка…").font(.system(size: 13)).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

struct EmptyCard: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 28))
                .foregroundColor(Brand.weekAll)
            Text("Лимиты не найдены").font(.system(size: 15, weight: .medium))
            Text("Возможно, у вас безлимитный план")
                .font(.system(size: 12)).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}

struct ErrorCard: View {
    let message: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundColor(.orange)
            Text(message)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}

struct NotLoggedInCard: View {
    let service: String
    let accent: Color
    let symbol: String
    let onLogin: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Circle()
                .fill(accent.opacity(0.15))
                .frame(width: 64, height: 64)
                .overlay(
                    Image(systemName: symbol)
                        .font(.system(size: 28))
                        .foregroundColor(accent)
                )
            Text("Войдите в \(service)").font(.system(size: 15, weight: .medium))
            Text("Для отображения лимитов нужна авторизация")
                .font(.system(size: 12)).foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button(action: onLogin) {
                Text("Войти в \(service)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 20)
                    .background(
                        RoundedRectangle(cornerRadius: 11, style: .continuous).fill(accent)
                    )
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

// MARK: - Debug panel

struct DebugPanel: View {
    let raw: String
    var body: some View {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        Text(text.isEmpty ? "(пусто — JS не вернул данных)" : text)
            .font(.system(size: 9, design: .monospaced))
            .foregroundColor(.secondary)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Brand.cardBG, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Preview

#Preview {
    ContentView().environmentObject({
        let s = UsageStore()
        s.claude.isLoggedIn = true
        s.claude.bars = [
            UsageBar(label: "Current session", percent: 0.12, resetAt: "Resets 10:20pm (Moscow)"),
            UsageBar(label: "Current week (all models)", percent: 0.05, resetAt: "Resets Jun 26 at 6:59am (Moscow)"),
            UsageBar(label: "Current week (Sonnet only)", percent: 0.88, resetAt: "Resets Jun 26 at 7:00am (Moscow)")
        ]
        return s
    }())
}
