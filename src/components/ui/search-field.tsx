import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SearchFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  clearLabel?: string;
};

export function SearchField({
  value,
  onValueChange,
  placeholder,
  className,
  inputClassName,
  clearLabel = "Clear search",
}: SearchFieldProps) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <Input
        className={cn("pr-9", inputClassName)}
        placeholder={placeholder}
        value={value}
        onChange={e => onValueChange(e.target.value)}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => onValueChange("")}
          aria-label={clearLabel}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
