import type { Logging } from 'homebridge';

export interface WebhookNotifierOptions {
  url: string;
  title: string;
  priority: string;
  tags: string;
  log: Logging;
}

export class WebhookNotifier {
  constructor(private readonly opts: WebhookNotifierOptions) {}

  async notify(message: string): Promise<void> {
    try {
      const res = await fetch(this.opts.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Title: this.opts.title,
          Priority: this.opts.priority,
          Tags: this.opts.tags,
        },
        body: message,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.opts.log.warn('Webhook HTTP %d: %s', res.status, body.slice(0, 200));
        return;
      }
      this.opts.log.debug('Notification sent: %s', message);
    } catch (err) {
      this.opts.log.warn('Webhook publish failed: %s', (err as Error).message);
    }
  }
}
