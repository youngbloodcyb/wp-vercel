import { initSandbox } from '@/lib/sandbox';

export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const sandbox = await initSandbox({ controller });

        // Send final message with sandbox URL
        const sandboxUrl = `${sandbox.domain(3000)}`;
        const finalPayload = {
          action: 'ready',
          step: 5,
          totalSteps: 5,
          text: 'Sandbox ready! ✅',
          sandboxUrl
        };

        controller.enqueue(
          new TextEncoder().encode(JSON.stringify(finalPayload) + '\n')
        );
        controller.close();
      } catch (error) {
        const errorPayload = {
          action: 'error',
          step: 0,
          totalSteps: 5,
          text: `Error: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        };

        controller.enqueue(
          new TextEncoder().encode(JSON.stringify(errorPayload) + '\n')
        );
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
