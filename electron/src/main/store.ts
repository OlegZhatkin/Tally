import type { AppState, ServiceId, VpnStatus } from '../shared/types';
import { emptyUsage } from '../shared/types';
import { getSettings } from './settings';
import { checkVpn } from './vpn';
import { fetchChatGPTPlan } from './usage/chatgpt';
import { fetchClaudeUsage } from './usage/claude';
import { ServiceSession } from './usage/service-session';

type Listener = (state: AppState) => void;

const IDLE_VPN: VpnStatus = { verdict: 'unknown', country: null, reason: 'Ещё не проверялось.', checkedAt: null };

class Store {
  readonly claudeSession = new ServiceSession({
    id: 'claude',
    origin: 'https://claude.ai',
    loginUrl: 'https://claude.ai/login',
    title: 'Вход в Claude',
  });

  readonly chatgptSession = new ServiceSession({
    id: 'chatgpt',
    origin: 'https://chatgpt.com',
    loginUrl: 'https://chatgpt.com/auth/login',
    title: 'Вход в ChatGPT',
  });

  private claude = emptyUsage();
  private chatgpt = emptyUsage();
  private vpn: VpnStatus = IDLE_VPN;
  private refreshing = false;
  private challengeRetry: NodeJS.Timeout | null = null;
  private challengeAttempts = 0;
  private readonly listeners = new Set<Listener>();

  getState(): AppState {
    return {
      claude: this.claude,
      chatgpt: this.chatgpt,
      vpn: this.vpn,
      settings: getSettings(),
      platform: process.platform,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    this.claude = { ...this.claude, isLoading: true };
    this.chatgpt = { ...this.chatgpt, isLoading: true };
    this.emit();

    try {
      const [claude, chatgpt] = await Promise.all([
        fetchClaudeUsage(this.claudeSession),
        fetchChatGPTPlan(this.chatgptSession),
      ]);
      this.claude = claude;
      this.chatgpt = chatgpt;
      this.emit();
      console.log(
        `[store] claude: loggedIn=${claude.isLoggedIn} bars=${claude.bars.length} challenge=${claude.needsChallenge}` +
          ` | chatgpt: loggedIn=${chatgpt.isLoggedIn} plan=${chatgpt.planName || '—'}`
      );

      this.handleChallenge(claude.needsChallenge);

      // Статус VPN обновляем следом: окно claude.ai к этому моменту точно поднято.
      this.vpn = await checkVpn(this.claudeSession, getSettings());
      console.log(`[store] vpn: ${this.vpn.verdict} (${this.vpn.country ?? '?'}) — ${this.vpn.reason}`);
    } catch (err) {
      console.error('[store] обновление не удалось:', err);
      this.claude = { ...this.claude, isLoading: false };
      this.chatgpt = { ...this.chatgpt, isLoading: false };
    } finally {
      this.refreshing = false;
      this.emit();
    }
  }

  /**
   * Заглушка Cloudflare часто рассасывается сама, когда страница дорешает проверку,
   * поэтому пробуем ещё пару раз, не дожидаясь общего интервала обновления.
   * Больше трёх попыток подряд не делаем — дальше решать проверку нужно в видимом окне.
   */
  private handleChallenge(challenged: boolean): void {
    if (this.challengeRetry) {
      clearTimeout(this.challengeRetry);
      this.challengeRetry = null;
    }
    if (!challenged) {
      this.challengeAttempts = 0;
      return;
    }
    if (this.challengeAttempts >= 3) return;

    this.challengeAttempts += 1;
    this.challengeRetry = setTimeout(() => {
      this.challengeRetry = null;
      void this.refresh();
    }, 45_000);
  }

  async refreshVpn(): Promise<VpnStatus> {
    this.vpn = await checkVpn(this.claudeSession, getSettings());
    this.emit();
    return this.vpn;
  }

  login(service: ServiceId): void {
    const session = service === 'claude' ? this.claudeSession : this.chatgptSession;
    session.showLogin(() => void this.refresh());
  }
}

export const store = new Store();
