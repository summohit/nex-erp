import json
from playwright.sync_api import sync_playwright

PROFILE_JS = r"""
() => {
  const pairs = [];
  document.querySelectorAll('div.row, div.col-md-6, div.col-12').forEach(row => {
    // Sometimes it's inside <p> or <h6>
    const ps = row.querySelectorAll('p');
    if (ps.length === 2) {
      pairs.push([(ps[0].innerText || '').trim(), (ps[1].innerText || '').trim()]);
    } else {
       // Look for label-like classes
       const label = row.querySelector('.text-dark-grey, .text-muted');
       const val = row.querySelector('.text-darkest-grey, .text-dark, .f-14');
       if(label && val) {
          pairs.push([(label.innerText || '').trim(), (val.innerText || '').trim()]);
       }
    }
  });
  return { pairs };
}
"""

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state="auth/cestech-hr.json")
        page = context.new_page()

        page.goto("https://cestech.workway.pro/account/job-applications/125")
        data = page.evaluate(PROFILE_JS)
        print("Application profile:")
        print(json.dumps(data, indent=2))
        
        page.goto("https://cestech.workway.pro/account/jobs/19")
        data = page.evaluate(PROFILE_JS)
        print("Job profile:")
        print(json.dumps(data, indent=2))

        browser.close()

if __name__ == "__main__":
    run()
