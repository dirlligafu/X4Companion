import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/hooks/useTheme";
import { BookOpen, FolderOpen, Map, Moon, Settings, Sun, Wrench, ArrowLeftRight } from "lucide-react";

type AppView = "editor" | "dictionaries" | "map" | "fitting" | "compare";

type AppHeaderProps = {
  path: string;
  hasData: boolean;
  view: AppView;
  onSetView: (v: AppView) => void;
  defaultSaveDir: string;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settingsDraft: string;
  setSettingsDraft: (v: string) => void;
  pickSettingsDir: () => Promise<void>;
  saveSettings: () => Promise<void>;
};

export function AppHeader({
  path,
  hasData,
  view,
  onSetView,
  defaultSaveDir,
  settingsOpen,
  setSettingsOpen,
  settingsDraft,
  setSettingsDraft,
  pickSettingsDir,
  saveSettings,
}: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
  
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">X4 Companion</h1>
        <p className="text-sm text-muted-foreground mt-0.5 hidden sm:block">
          Load a save, edit, apply, play! Backup is created automatically. Partial encyclopedia included.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          variant={view === "dictionaries" ? "default" : "outline"}
          size="sm"
          onClick={() => onSetView(view === "dictionaries" ? "editor" : "dictionaries")}
          title="Game reference data"
        >
          <BookOpen className="h-4 w-4 mr-1.5" />Dictionaries
        </Button>
        <Button
          type="button"
          variant={view === "map" ? "default" : "outline"}
          size="sm"
          onClick={() => onSetView(view === "map" ? "editor" : "map")}
          title="Universe map"
        >
          <Map className="h-4 w-4 mr-1.5" />Map
        </Button>
        <Button
          type="button"
          variant={view === "fitting" ? "default" : "outline"}
          size="sm"
          onClick={() => onSetView(view === "fitting" ? "editor" : "fitting")}
          title="Ship fitting tool"
        >
          <Wrench className="h-4 w-4 mr-1.5" />Fitting
        </Button>
        <Button
          type="button"
          variant={view === "compare" ? "default" : "outline"}
          size="sm"
          onClick={() => onSetView(view === "compare" ? "editor" : "compare")}
          title="Compare ships"
        >
          <ArrowLeftRight className="h-4 w-4 mr-1.5" />Compare
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {hasData && (
          <Badge variant="outline" className="text-muted-foreground font-mono text-xs">
            {path.endsWith(".gz") ? ".xml.gz" : ".xml"}
          </Badge>
        )}
        <Dialog
          open={settingsOpen}
          onOpenChange={open => {
            setSettingsOpen(open);
            if (open) setSettingsDraft(defaultSaveDir);
          }}
        >
          <DialogTrigger className="inline-flex items-center justify-center rounded-md h-9 w-9 hover:bg-accent hover:text-accent-foreground">
            <Settings className="h-4 w-4" />
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Preferences</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label>X4 saves folder</Label>
              <div className="flex gap-2">
                <Input
                  value={settingsDraft}
                  onChange={e => setSettingsDraft(e.target.value)}
                  placeholder="C:\Users\…\Documents\Egosoft\X4\…\save"
                  className="font-mono text-sm"
                />
                <Button type="button" variant="outline" onClick={() => void pickSettingsDir()}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The file picker will open directly in this folder.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSettingsOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void saveSettings()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
