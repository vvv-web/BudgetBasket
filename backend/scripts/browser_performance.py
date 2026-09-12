"""Playwright smoke/profile against the isolated audit API, without writes."""
import argparse
import json
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frontend", default="http://localhost:5174")
    parser.add_argument("--api", default="http://localhost:18002")
    parser.add_argument("--output", default="docs/performance/browser.json")
    args = parser.parse_args()
    auth = httpx.post(args.api + "/auth/login", json={"login": "admin", "password": "admin"}).json()
    errors, requests = [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda error: errors.append(str(error)))
        def proxy(route):
            suffix = route.request.url.split("/api", 1)[1]
            response = route.fetch(url=args.api + suffix)
            requests.append({"path": suffix, "method": route.request.method, "status": response.status, "bytes": len(response.body()), "body": route.request.post_data_json if route.request.method == "POST" else None})
            route.fulfill(response=response)
        page.route(args.frontend + "/api/**", proxy)
        page.add_init_script("window.__longTasks=[];new PerformanceObserver(l=>window.__longTasks.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});")
        page.goto(args.frontend + "/login")
        page.evaluate("a=>{localStorage.setItem('budgetbasket_token',a.access_token);localStorage.setItem('budgetbasket_user',JSON.stringify(a.user));}", auth)
        start = time.perf_counter()
        page.goto(args.frontend + "/requests")
        page.locator('.approval-register-table tbody tr[data-index]').first.wait_for(timeout=60000)
        initial_ms = (time.perf_counter() - start) * 1000
        page.wait_for_timeout(600)
        table = page.locator('.approval-register-table')
        initial_rows = table.locator('tbody tr').count()
        initial_calls = len(requests)
        # Expanding a leaf must retrieve at most one page of detailed lines.
        table.locator('button[aria-label="Раскрыть группу"]').first.click()
        page.locator('.approval-register-row--item').first.wait_for(timeout=60000)
        page.wait_for_timeout(500)
        expanded_rows = table.locator('tbody tr').count()
        item = table.locator('.approval-register-row--item').first
        item.focus()
        focused_index = item.get_attribute('data-index')
        item.press('ArrowDown')
        page.wait_for_timeout(200)
        keyboard_index = page.locator(':focus').get_attribute('data-index')
        table.evaluate('(e)=>e.scrollTop=e.scrollHeight')
        page.wait_for_timeout(600)
        end_rows = table.locator('tbody tr').count()
        table.evaluate('(e)=>e.scrollTop=0')
        page.wait_for_timeout(300)
        resources = page.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.js')).map(e=>({name:e.name.split('/').pop(),bytes:e.decodedBodySize,transfer:e.transferSize}))")
        long_tasks = page.evaluate('window.__longTasks')
        page.screenshot(path=str(Path(args.output).with_suffix('.png')), full_page=True)
        page.goto(args.frontend + '/')
        start = time.perf_counter()
        page.goto(args.frontend + '/requests')
        page.locator('.approval-register-table tbody tr[data-index]').first.wait_for(timeout=60000)
        repeated_ms = (time.perf_counter() - start) * 1000
        result = {"initial_ms": round(initial_ms, 2), "repeated_navigation_ms": round(repeated_ms, 2), "initial_dom_rows": initial_rows, "expanded_dom_rows": expanded_rows, "end_dom_rows": end_rows, "initial_api_calls": initial_calls, "keyboard_moved": focused_index != keyboard_index, "long_tasks_ms": long_tasks, "js_resources": resources, "requests": requests, "errors": errors}
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({key: value for key, value in result.items() if key not in {'requests', 'js_resources', 'long_tasks_ms'}}, ensure_ascii=True))
        browser.close()


if __name__ == '__main__':
    main()
