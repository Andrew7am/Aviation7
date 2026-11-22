import React from 'react';

/**
 * Every screen's heading, one way.
 *
 * The twenty screens had six: 10px grey capitals, 12px slate capitals, an 18px
 * bold title, a 14px one in a card... and a screen's name was the faintest
 * thing on it. Now each opens with the same three parts:
 *
 *   - the icon the menu shows for it, in the muted grey;
 *   - the title, 18px semibold in ink - the strongest text on the screen
 *     until its figures start;
 *   - a line or two of what the screen is for, in the secondary grey.
 *
 * A badge (Admin) can sit beside the title. The screen's own controls go in
 * `actions` and sit to the right, wrapping under the title on a phone.
 *
 * Two settings: `band` is a white strip across the top of a full-bleed
 * screen (the ledger, requests, reports); `plain` sits inside a screen that
 * is padded already, with nothing drawn around it.
 */
export const PageTitle: React.FC<{
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: string;
  className?: string;
}> = ({ icon, title, subtitle, badge, className = '' }) => (
  <div className={`min-w-0 ${className}`}>
    <h2 className="flex items-center gap-2 text-lg leading-7 font-semibold text-slate-900 tracking-tight">
      {icon && <span className="shrink-0 text-slate-400 [&>svg]:w-5 [&>svg]:h-5" aria-hidden="true">{icon}</span>}
      <span className="min-w-0">{title}</span>
      {badge && (
        <span className="shrink-0 text-micro font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded
                         bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
          {badge}
        </span>
      )}
    </h2>
    {subtitle && <div className="mt-1 text-xs leading-relaxed text-slate-500 max-w-3xl">{subtitle}</div>}
  </div>
);

export const PageHeader: React.FC<{
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: string;
  actions?: React.ReactNode;
  variant?: 'band' | 'plain';
  className?: string;
}> = ({ icon, title, subtitle, badge, actions, variant = 'plain', className = '' }) => (
  <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-3 ${
    variant === 'band' ? 'px-4 sm:px-6 py-4 bg-white border-b border-slate-200 shrink-0' : ''} ${className}`}>
    <PageTitle icon={icon} title={title} subtitle={subtitle} badge={badge} className="flex-1 basis-64" />
    {actions && <div className="flex flex-wrap items-center gap-2 max-w-full">{actions}</div>}
  </div>
);

export default PageHeader;
