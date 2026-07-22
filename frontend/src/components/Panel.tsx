import { PropsWithChildren, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PanelProps = PropsWithChildren<{
  title: string;
  eyebrow?: string;
  action?: ReactNode;
}>;

export function Panel({ title, eyebrow, action, children }: PanelProps) {
  return (
    <Card className="border-border/80">
      <CardHeader className="flex-row items-start justify-between gap-3 px-5">
        <div>
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">
              {eyebrow}
            </p>
          ) : null}
          <CardTitle className="mt-1 text-xl font-bold">{title}</CardTitle>
        </div>
        {action}
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
    </Card>
  );
}
