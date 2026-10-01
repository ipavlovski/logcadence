import React from 'react'
import { ImageGallery } from 'logseq-rewrite'

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, width: 520 }}>{children}</div>
)

// Self-contained photo stand-ins (inline SVG landscapes) so the card needs no network.
const photo = (sky: string, sun: string, hill: string, near: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${sun}"/></linearGradient></defs><rect width="640" height="420" fill="url(#s)"/><circle cx="460" cy="170" r="46" fill="${sun}" opacity=".9"/><path d="M0 300 Q160 210 330 280 T640 250 V420 H0Z" fill="${hill}"/><path d="M0 350 Q200 300 400 345 T640 330 V420 H0Z" fill="${near}"/></svg>`,
  )

const images = [
  { id: 'a', url: photo('#355c7d', '#f8b195', '#2a3d52', '#1b2836'), mime: 'image/svg+xml' },
  { id: 'b', url: photo('#88c0d0', '#ebcb8b', '#5e81ac', '#3b4252'), mime: 'image/svg+xml' },
  { id: 'c', url: photo('#6c5b7b', '#f67280', '#45394f', '#2c2433'), mime: 'image/svg+xml' },
  { id: 'd', url: photo('#a3be8c', '#fdf6e3', '#6d8a5a', '#4c6340'), mime: 'image/svg+xml' },
]

export const Strip = () => {
  const [active, setActive] = React.useState('b')
  return (
    <Frame>
      <ImageGallery images={images} activeId={active} onActivate={setActive} />
    </Frame>
  )
}

export const Compact = () => (
  <Frame>
    <ImageGallery images={images.slice(0, 2)} activeId="a" compact />
  </Frame>
)

export const SingleImage = () => (
  <Frame>
    <ImageGallery images={images.slice(2, 3)} activeId={null} />
  </Frame>
)
