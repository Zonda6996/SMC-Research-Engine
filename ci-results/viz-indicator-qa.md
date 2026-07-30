# Visualizer QA — Apex/Reversal + Б1

- fatal: TimeoutError: locator.fill: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('#apexLookback')
    - locator resolved to <input min="20" max="1000" value="200" class="input" type="number" id="apexLookback"/>
    - fill("201")
  - attempting fill action
    2 × waiting for element to be visible, enabled and editable
      - element is not visible
    - retrying fill action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and editable
      - element is not visible
    - retrying fill action
      - waiting 100ms
    60 × waiting for element to be visible, enabled and editable
       - element is not visible
     - retrying fill action
       - waiting 500ms

