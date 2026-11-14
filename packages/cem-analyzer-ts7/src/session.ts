import type {
  DiscoveryResult,
  SemanticReference,
  SourceOverlay,
  VirtualSourceFile,
} from './contracts.js';

export interface VirtualSymlink {
  target: string;
}

interface DiscoveryOptionsBase {
  currentDirectory?: string;
  files?: readonly VirtualSourceFile[];
  overlays?: readonly SourceOverlay[];
  symlinks?: Readonly<Record<string, VirtualSymlink>>;
}

export interface StandaloneDiscoveryOptions extends DiscoveryOptionsBase {
  mode: 'standalone';
  rootFiles: readonly string[];
  compilerOptions?: Readonly<Record<string, unknown>>;
}

export interface ConsumerDiscoveryOptions extends DiscoveryOptionsBase {
  mode: 'consumer';
  configFileName: string;
}

export type DiscoveryOptions =
  StandaloneDiscoveryOptions | ConsumerDiscoveryOptions;

export interface DiscoverySession {
  collect(): Promise<DiscoveryResult>;
  update(overlays: readonly SourceOverlay[]): Promise<DiscoveryResult>;
  getTypeAtPosition(
    fileName: string,
    position: number
  ): Promise<SemanticReference | undefined>;
  isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean>;
  dispose(): Promise<void>;
}
