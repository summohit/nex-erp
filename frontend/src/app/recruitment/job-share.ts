/**
 * One way to build and share a job's public link, used by Job Postings, the
 * job detail page and the careers page alike: the company's careers page with
 * `?job=<id>`, which opens that posting directly.
 */
export function jobPublicUrl(_companyId: number | string, jobId: number | string): string {
  // No encoded company id in the address (16 Nov 2026): /careers lists every
  // open posting and ?job= opens this one.
  return `${window.location.origin}/careers?job=${encodeURIComponent(String(jobId))}`;
}

export function shareJobOnWhatsApp(title: string, location: string | null | undefined, url: string): void {
  const text = `We are hiring: ${title}${location ? ' (' + location + ')' : ''} at CES Tech. View details and apply: ${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
  }
}
