import { cn } from '@/lib/utils';

type OnboardingRequirementsProps = {
  requirements: string[];
  title?: string;
  className?: string;
  live?: 'off' | 'polite' | 'assertive';
};

export default function OnboardingRequirements({
  requirements,
  title = 'Para completar este paso:',
  className,
  live = 'polite',
}: OnboardingRequirementsProps) {
  if (requirements.length === 0) return null;

  return (
    <div role="status" aria-live={live} className={cn('rounded-md border border-amber-300/70 bg-amber-50/70 p-2 text-xs text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-100', className)}>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {requirements.map(requirement => <li key={requirement}>{requirement}</li>)}
      </ul>
    </div>
  );
}
