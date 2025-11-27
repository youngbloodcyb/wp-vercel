'use client';

import { Container, Section } from '@/components/craft';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

type StepUpdate = {
  action: string;
  step: number;
  totalSteps: number;
  text: string;
  sandboxUrl?: string;
};

export default function Page() {
  const [isLoading, setIsLoading] = useState(false);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [updates, setUpdates] = useState<StepUpdate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const initializeSandbox = async () => {
    setIsLoading(true);
    setError(null);
    setUpdates([]);
    setSandboxUrl(null);

    try {
      const response = await fetch('/api/sandbox');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          const update: StepUpdate = JSON.parse(line);
          setUpdates((prev) => [...prev, update]);

          if (update.action === 'ready' && update.sandboxUrl) {
            setSandboxUrl(update.sandboxUrl);
          } else if (update.action === 'error') {
            setError(update.text);
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Failed to initialize sandbox:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Section>
      <Container>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">WordPress Sandbox</h1>
            <Button
              onClick={initializeSandbox}
              disabled={isLoading || !!sandboxUrl}
            >
              {isLoading
                ? 'Initializing...'
                : sandboxUrl
                ? 'Sandbox Running'
                : 'Start Sandbox'}
            </Button>
          </div>

          {/* Progress updates */}
          {updates.length > 0 && (
            <div className="rounded-lg border bg-muted/50 p-4">
              <h2 className="mb-2 text-sm font-semibold">Progress:</h2>
              <div className="space-y-1 text-sm">
                {updates.map((update, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 ${
                      update.action === 'error'
                        ? 'text-destructive'
                        : update.action === 'ready'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    <span className="text-xs">
                      [{update.step}/{update.totalSteps}]
                    </span>
                    <span>{update.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Sandbox iframe */}
          {sandboxUrl && (
            <div className="h-[800px] w-full overflow-hidden rounded-lg border">
              <iframe
                src={`${sandboxUrl}/wp-admin`}
                className="h-full w-full"
                title="WordPress Sandbox"
              />
            </div>
          )}

          {/* Placeholder when no sandbox */}
          {!sandboxUrl && !isLoading && updates.length === 0 && (
            <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Click "Start Sandbox" to initialize a WordPress instance
                </p>
              </div>
            </div>
          )}
        </div>
      </Container>
    </Section>
  );
}
