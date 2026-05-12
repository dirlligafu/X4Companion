import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MessageEntry } from "@/types/save";

type MessagesTabProps = {
  path: string;
};

function fmtGameTime(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// [\012] → newline in X4 message text
function cleanText(raw: string): string {
  return raw.replace(/\[\\012\]/g, "\n").replace(/&quot;/g, '"');
}

export function MessagesTab({ path }: MessagesTabProps) {
  const [messages, setMessages] = useState<MessageEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    setMessages(null);
    setError(null);
    setExpandedId(null);
    invoke<MessageEntry[]>("parse_player_messages", { path })
      .then(setMessages)
      .catch(e => setError(String(e)));
  }, [path]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {messages === null && !error && (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        )}
        {messages !== null && (
          <>
            <p className="text-xs text-muted-foreground shrink-0">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
            </p>
            <ScrollArea className="min-h-0 flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-center">Time</TableHead>
                    <TableHead className="text-center">Priority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map(msg => {
                    const isExpanded = expandedId === msg.id;
                    const hasText = msg.text.length > 0;
                    return (
                      <>
                        <TableRow
                          key={msg.id}
                          className={hasText ? "cursor-pointer" : ""}
                          onClick={() => hasText && setExpandedId(isExpanded ? null : msg.id)}
                        >
                          <TableCell className="font-medium">
                            {msg.title || <span className="italic text-muted-foreground/50">no title</span>}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {msg.source || "—"}
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs text-muted-foreground">
                            {fmtGameTime(msg.time)}
                          </TableCell>
                          <TableCell className="text-center">
                            {msg.high_priority && (
                              <span className="inline-block rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600 dark:text-red-400">
                                High
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${msg.id}-text`} className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={4} className="py-3 px-4">
                              <p className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                                {cleanText(msg.text)}
                              </p>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}
