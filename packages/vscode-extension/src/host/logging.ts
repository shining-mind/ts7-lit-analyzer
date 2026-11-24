import {window, type Disposable, type LogOutputChannel} from 'vscode';

export type LoggingLevel = 'normal' | 'verbose' | 'debug';

export interface CoordinatorLogger {
  normal(event: string, fields?: Readonly<Record<string, unknown>>): void;
  verbose(event: string, fields?: Readonly<Record<string, unknown>>): void;
  debug(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export class ExtensionLogger implements CoordinatorLogger, Disposable {
  private readonly channel: LogOutputChannel;
  private level: LoggingLevel;

  constructor(level: LoggingLevel, channel?: LogOutputChannel) {
    this.level = level;
    this.channel =
      channel ??
      window.createOutputChannel('TypeScript 7 Lit Analyzer', {log: true});
  }

  get instrumented(): boolean {
    return this.level !== 'normal';
  }

  get debugEnabled(): boolean {
    return this.level === 'debug';
  }

  setLevel(level: LoggingLevel): void {
    this.level = level;
  }

  normal(event: string, fields?: Readonly<Record<string, unknown>>): void {
    this.write('INFO', event, fields);
  }

  verbose(event: string, fields?: Readonly<Record<string, unknown>>): void {
    if (this.instrumented) {
      this.write('VERBOSE', event, fields);
    }
  }

  debug(event: string, fields?: Readonly<Record<string, unknown>>): void {
    if (this.debugEnabled) {
      this.write('DEBUG', event, fields);
    }
  }

  error(event: string, fields?: Readonly<Record<string, unknown>>): void {
    this.channel.error(`${event} ${formatFields(fields)}`);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private write(
    level: 'INFO' | 'VERBOSE' | 'DEBUG',
    event: string,
    fields?: Readonly<Record<string, unknown>>
  ): void {
    this.channel.info(`[${level}] ${event} ${formatFields(fields)}`);
  }
}

function formatFields(fields?: Readonly<Record<string, unknown>>): string {
  return fields ? JSON.stringify(fields) : '';
}
