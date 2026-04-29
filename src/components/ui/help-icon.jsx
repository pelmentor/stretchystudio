import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * A reusable '?' icon that shows a tooltip on hover.
 */
export function HelpIcon({ tip, side = 'left', className = '' }) {
  if (!tip) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className={`text-muted-foreground/40 hover:text-muted-foreground/60 cursor-help flex-shrink-0 ${className}`}
          >
            <circle cx="6" cy="6" r="5.5" />
            <text
              x="6"
              y="8"
              fontSize="8"
              textAnchor="middle"
              fill="currentColor"
              fontWeight="bold"
            >
              ?
            </text>
          </svg>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-xs">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
