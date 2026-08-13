import { execFile } from 'node:child_process';

const POLL_MS = 3_000;

/**
 * Запущено ли десктопное приложение Claude.
 * macOS: точное имя процесса `Claude` (хелперы называются «Claude Helper»).
 * Windows: `claude.exe` в списке задач.
 */
function isClaudeRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      execFile('pgrep', ['-x', 'Claude'], (error, stdout) => resolve(!error && stdout.trim().length > 0));
      return;
    }
    if (process.platform === 'win32') {
      execFile(
        'tasklist',
        ['/NH', '/FI', 'IMAGENAME eq claude.exe'],
        { windowsHide: true },
        (error, stdout) => resolve(!error && stdout.toLowerCase().includes('claude.exe'))
      );
      return;
    }
    resolve(false);
  });
}

/**
 * Следит за запуском Claude и дёргает `onLaunched` на переходе
 * «не запущен → запущен». Если Claude уже работал на старте приложения,
 * это за запуск не считается — иначе предупреждение вылезало бы при каждом
 * перезапуске самого Tally.
 */
export function startClaudeWatcher(onLaunched: () => void): () => void {
  let wasRunning: boolean | null = null;
  let stopped = false;

  const tick = async () => {
    const running = await isClaudeRunning();
    if (stopped) return;
    if (wasRunning === false && running) onLaunched();
    wasRunning = running;
  };

  void tick();
  const timer = setInterval(() => void tick(), POLL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
