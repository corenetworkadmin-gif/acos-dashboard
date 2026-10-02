import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Widget = ({ title, children, className }: { 
  title: string; 
  children: React.ReactNode; 
  className?: string 
}) => {
  return (
    <Card className={`bg-black/30 border border-white/10 backdrop-blur-sm ${className}`}>
      <CardHeader className="pb-4">
        <CardTitle className="text-cyan-400 font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
};