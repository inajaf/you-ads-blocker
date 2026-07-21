import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FAQS,
  FAQ_OPEN_MAX_HEIGHT,
  faqVisual,
  toggleFaq,
} from '../src/landing/faq.ts'
import { isAppPath, APP_BASENAME } from '../src/appRoutes.ts'

test('toggleFaq opens a closed item without mutating the input set', () => {
  const original = new Set([1])
  const next = toggleFaq(original, 0)
  assert.deepEqual([...next].sort(), [0, 1])
  // input is untouched (pure)
  assert.deepEqual([...original], [1])
})

test('toggleFaq closes an already-open item', () => {
  const next = toggleFaq(new Set([0, 2]), 2)
  assert.deepEqual([...next].sort(), [0])
})

test('toggleFaq allows multiple items open at once', () => {
  let open = new Set()
  open = toggleFaq(open, 0)
  open = toggleFaq(open, 3)
  open = toggleFaq(open, 1)
  assert.deepEqual([...open].sort(), [0, 1, 3])
})

test('faqVisual rotates the + icon to 45deg and expands only when open', () => {
  const closed = faqVisual(false)
  assert.equal(closed.rotation, 'rotate(0deg)')
  assert.equal(closed.maxHeight, '0px')

  const opened = faqVisual(true)
  assert.equal(opened.rotation, 'rotate(45deg)')
  assert.equal(opened.maxHeight, FAQ_OPEN_MAX_HEIGHT)
})

test('FAQS carries the four questions from the design', () => {
  assert.equal(FAQS.length, 4)
  for (const f of FAQS) {
    assert.equal(typeof f.q, 'string')
    assert.ok(f.q.length > 0)
    assert.ok(f.a.length > 0)
  }
})

test('isAppPath matches /app and its descendants but not the landing root', () => {
  assert.equal(APP_BASENAME, '/app')
  assert.equal(isAppPath('/app'), true)
  assert.equal(isAppPath('/app/'), true)
  assert.equal(isAppPath('/app/search'), true)
  assert.equal(isAppPath('/app/watch/abc123'), true)

  // Landing owns the root and everything that is not under /app.
  assert.equal(isAppPath('/'), false)
  assert.equal(isAppPath('/appearance'), false) // not a real /app boundary
  assert.equal(isAppPath('/watch/abc123'), false)
  assert.equal(isAppPath('/anything-else'), false)
})
