import json
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state="auth/cestech-hr.json")
        page = context.new_page()

        page.goto("https://cestech.workway.pro/account/job-applications/125")
        
        # Find any links that might be the resume
        links = page.evaluate("""
        () => {
            return [...document.querySelectorAll('a[href]')].map(a => {
                return {
                    text: a.innerText.trim(),
                    href: a.getAttribute('href'),
                    html: a.outerHTML
                };
            }).filter(l => l.href.includes('cloudfront') || l.href.includes('download') || l.href.includes('application-files') || l.text.toLowerCase().includes('view') || l.text.toLowerCase().includes('download'));
        }
        """)
        print(json.dumps(links, indent=2))
        
        browser.close()

if __name__ == "__main__":
    run()
