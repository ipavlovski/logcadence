import { describe, expect, it } from 'vitest'
import { cleanFields, handlerById, handlerFor } from './handlers.ts'

const pick = (url: string) => {
  const { handler, key } = handlerFor(new URL(url))
  return [handler.id, key]
}

describe('handlers', () => {
  it('reads a Reddit post from its link, a comment link, old reddit and redd.it', () => {
    expect(pick('https://www.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/?utm_source=share')).toEqual(['reddit', '1kq2x3v'])
    expect(pick('https://old.reddit.com/r/selfhosted/comments/1KQ2X3V/my_homelab_tour/mt0abcd/')).toEqual(['reddit', '1kq2x3v'])
    expect(pick('https://www.reddit.com/comments/1kq2x3v')).toEqual(['reddit', '1kq2x3v'])
    expect(pick('https://redd.it/1kq2x3v')).toEqual(['reddit', '1kq2x3v'])
    expect(pick('https://www.reddit.com/r/selfhosted/')).toEqual(['page', 'https://www.reddit.com/r/selfhosted/'])
    expect(pick('https://example.com/comments/1kq2x3v/')[0]).toBe('page')
  })

  it('reads a Marketplace listing’s id, however it was linked', () => {
    expect(pick('https://www.facebook.com/marketplace/item/1234567890/?ref=search')).toEqual(['marketplace', '1234567890'])
    expect(pick('https://m.facebook.com/marketplace/item/1234567890')).toEqual(['marketplace', '1234567890'])
    expect(pick('https://www.facebook.com/marketplace/berlin/item/1234567890/')).toEqual(['marketplace', '1234567890'])
    expect(pick('https://www.facebook.com/marketplace/berlin/')[0]).toBe('page')
    expect(pick('https://notfacebook.com/marketplace/item/1/')[0]).toBe('page')
  })

  it('keys any other page by its url without the #fragment', () => {
    expect(pick('https://example.com/docs?page=2#intro')).toEqual(['page', 'https://example.com/docs?page=2'])
  })

  it('keeps a handler’s own fields only, typed', () => {
    expect(cleanFields(handlerById('reddit'), { author: ' u/alice ', score: '1,204', commentCount: 'many', price: 3 })).toEqual({ author: 'alice', score: 1204 })
    expect(cleanFields(handlerById('marketplace'), { price: '€250', seller: '  ', location: 12 })).toEqual({ price: '€250', location: '12' })
    expect(cleanFields(handlerById('page'), { author: 'x' })).toEqual({})
    expect(cleanFields(handlerById('reddit'), 'junk')).toEqual({})
  })
})
