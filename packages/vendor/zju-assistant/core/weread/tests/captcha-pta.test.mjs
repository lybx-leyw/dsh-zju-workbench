import test from 'node:test'
import assert from 'node:assert/strict'
import { matchPtaSlider, PtaSliderRecognizer } from '../lib/captcha/pta.mjs'
import { ptaImages } from './fixtures/pta-slider.mjs'

test('PTA matches darkened texture at original coordinates, retaining transparent padding', () => {
  for (const targetX of [0, 90, 185, 256]) {
    const { background, piece, position, answer } = ptaImages({ targetX, seed: targetX + 1 })
    assert.deepEqual(matchPtaSlider(background, piece, position), answer)
  }
})

test('PTA does not guess for blank texture, duplicate gaps, unrelated images or invalid geometry', () => {
  for (const options of [{ flat: true }, { duplicate: true }]) {
    const { background, piece, position } = ptaImages(options)
    assert.equal(matchPtaSlider(background, piece, position), undefined)
  }
  const { background, piece, position } = ptaImages()
  const other = ptaImages({ seed: 17 })
  assert.equal(matchPtaSlider(background, other.piece, position), undefined)
  assert.equal(matchPtaSlider(background, piece, { y: -1 }), undefined)
  assert.equal(matchPtaSlider(background, piece, { y: 150 }), undefined)
  assert.equal(matchPtaSlider(background, { ...piece, data: [] }, position), undefined)
})

test('PTA refuses other puzzle kinds and cancellation before running local recognition', async () => {
  const recognizer = new PtaSliderRecognizer({ executeJavaScript: () => assert.fail('must not run') })
  for (const kind of ['image-choice', 'ordered-click', 'audio']) {
    await assert.rejects(recognizer.recognize({ kind }), { code: 'unsupported_verification' })
  }
  await assert.rejects(recognizer.recognize({ kind: 'slider', signal: AbortSignal.abort(new Error('cancelled')) }), /cancelled/)
})

test('PTA uncertainty and cancellation after local recognition cannot produce an answer', async () => {
  const puzzle = { kind: 'slider', background: {}, piece: {} }
  await assert.rejects(new PtaSliderRecognizer({ executeJavaScript: async () => null }).recognize(puzzle), { code: 'recognition_uncertain' })
  const controller = new AbortController()
  const recognizer = new PtaSliderRecognizer({ executeJavaScript: async () => { controller.abort(new Error('cancelled')); return { targetX: 100, targetY: 30 } } })
  await assert.rejects(recognizer.recognize({ ...puzzle, signal: controller.signal }), /cancelled/)
})
