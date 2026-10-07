import { EventEmitter } from 'node:events';

// --- Device Bridge Stub (Microphone / Camera) ---
export class MockDeviceBridge {
  private isAuthorized: boolean = false;

  constructor(private deviceType: 'microphone' | 'camera') {}

  async requestPermission(operationId: string): Promise<boolean> {
    // Simulates a user prompt delay and automatic approval for testing
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.isAuthorized = true;
    return true;
  }

  async startStream(operationId: string): Promise<AsyncIterable<Uint8Array>> {
    if (!this.isAuthorized) {
      throw new Error('DEVICE_PERMISSION_DENIED');
    }

    // Return a mock stream of "audio/video" data
    return (async function* () {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield new Uint8Array([0x01, 0x02, 0x03, i]); // Mock frame data
      }
    })();
  }

  async stopStream(operationId: string): Promise<void> {
    this.isAuthorized = false;
  }
}

// --- Remote Transport Stub (remote.execute) ---
export class MockRemoteTransport {
  private allowedCommands: Set<string>;

  constructor(allowedCommands: string[] = ['echo', 'uname']) {
    this.allowedCommands = new Set(allowedCommands);
  }

  async executeCommand(
    operationId: string,
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    
    const fullCmd = `${command} ${args.join(' ')}`.trim();
    const baseCmd = command.toLowerCase();

    if (!this.allowedCommands.has(baseCmd)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Command '${command}' is not in the allowed stub list.`,
      };
    }

    // Simulate execution delay
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (baseCmd === 'echo') {
      return { exitCode: 0, stdout: args.join(' ') + '\n', stderr: '' };
    }
    
    if (baseCmd === 'uname') {
      return { exitCode: 0, stdout: 'MockOS 1.0.0-stub\n', stderr: '' };
    }

    return { exitCode: 1, stdout: '', stderr: 'Unknown stub command' };
  }
}
