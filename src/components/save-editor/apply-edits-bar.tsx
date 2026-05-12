import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

type ApplyEditsBarProps = {
  busy: boolean;
  saving: boolean;
  onApply: () => Promise<void>;
};

export function ApplyEditsBar({ busy, saving, onApply }: ApplyEditsBarProps) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-border">
      <span className="text-xs text-muted-foreground">
        A .bak backup will be created automatically.
      </span>
      <Button type="button" onClick={() => void onApply()} disabled={busy} className="shrink-0">
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Saving…
          </>
        ) : (
          <>
            <Save className="h-4 w-4 mr-2" />
            Apply
          </>
        )}
      </Button>
    </div>
  );
}
