import { CheckCircle2, XCircle } from "lucide-react";

type FeedbackMessagesProps = {
  error: string;
  saveMsg: string;
};

export function FeedbackMessages({ error, saveMsg }: FeedbackMessagesProps) {
  return (
    <>
      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {saveMsg && (
        <div className="flex items-center gap-2 text-green-500 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {saveMsg}
        </div>
      )}
    </>
  );
}
