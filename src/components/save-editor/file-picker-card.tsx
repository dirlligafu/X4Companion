import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { FileX2, FolderOpen, Loader2 } from "lucide-react";

type FilePickerCardProps = {
  path: string;
  setPath: (v: string) => void;
  busy: boolean;
  loading: boolean;
  progress: number | null;
  hasData: boolean;
  onPickFile: () => Promise<void>;
  onLoad: () => Promise<void>;
  onCloseFile: () => void;
};

export function FilePickerCard({
  path,
  setPath,
  busy,
  loading,
  progress,
  hasData,
  onPickFile,
  onLoad,
  onCloseFile,
}: FilePickerCardProps) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <Input
            placeholder="Path to save file (.xml or .gz)"
            value={path}
            onChange={e => setPath(e.target.value)}
            onKeyDown={e => e.key === "Enter" && void onLoad()}
            disabled={busy}
            className="font-mono text-sm sm:flex-1 min-w-0"
          />
          <div className="flex gap-2 shrink-0">
            <Button type="button" variant="outline" onClick={() => void onPickFile()} disabled={busy}>
              <FolderOpen className="h-4 w-4" />
            </Button>
            <Button type="button" onClick={() => void onLoad()} disabled={busy || !path.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load"}
            </Button>
            {hasData && (
              <Button type="button" variant="ghost" onClick={onCloseFile} disabled={busy}>
                <FileX2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {progress !== null && <Progress value={progress} className="mt-3 h-1.5" />}
      </CardContent>
    </Card>
  );
}
