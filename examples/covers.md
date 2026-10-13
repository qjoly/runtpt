---
title: Covers
runtpt:
  shell: bash
  presentation:
    slides: h2
    cover: split
    image: assets/cover-hero.svg
---

# Covers

A deck opens on a title, not on a bullet list. Slide 0 gets a layout of its own.

## What the frontmatter says

Four layouts, picked in `runtpt.presentation`:

| `cover` | what it does |
| --- | --- |
| `auto` | a cover only when slide 0 is a title and little else (the default) |
| `center` | title centred, image contained underneath |
| `split` | text one side, image the other |
| `full` | image edge to edge behind the text, under a scrim |
| `band` | image as a band across the top, text below |
| `none` | never a cover |

`image` is a relative path like any markdown image, read from the runbook's own directory.

## Nothing else changes

The cover is slide 0 and nothing but slide 0: the counter, the presenter view and
`<!-- runtpt:pause -->` behave exactly as they did.

<!-- notes: swap `cover:` in the frontmatter to show another layout. -->

```bash
echo "slides still run cells"
```

## Without an image

`split` and `full` need a picture; without one they fall back to `center`, which
is the layout that never needs anything. A cover image that fails to load does
the same, so a deck opened without its assets still opens on its title.
