# Visualizer QA — Apex/Reversal + Б1

- duplicate DOM ids: 0
- fatal: TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.indicator-settings details').first().locator('summary')
    - locator resolved to <summary>Zonda Apex · настройки</summary>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
      - waiting 100ms
    58 × waiting for element to be visible, enabled and stable
       - element is not visible
     - retrying click action
       - waiting 500ms

