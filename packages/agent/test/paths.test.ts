import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { relativeToRoot, resolveInRoot } from '../src/paths.js'

function tmpRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'runtpt-root-'))
}

describe('resolveInRoot', () => {
  it('accepts paths inside the root', () => {
    const root = tmpRoot()
    mkdirSync(path.join(root, 'sub'))
    writeFileSync(path.join(root, 'sub', 'a.md'), 'x')
    expect(resolveInRoot(root, 'sub/a.md')).toBe(path.join(root, 'sub', 'a.md'))
    expect(resolveInRoot(root, '.')).toBe(path.resolve(root))
    expect(resolveInRoot(root, 'sub/../sub/a.md')).toBe(path.join(root, 'sub', 'a.md'))
  })

  it('rejects traversal out of the root', () => {
    const root = tmpRoot()
    expect(resolveInRoot(root, '../etc/passwd')).toBeNull()
    expect(resolveInRoot(root, 'sub/../../outside')).toBeNull()
    expect(resolveInRoot(root, '..')).toBeNull()
  })

  it('rejects absolute paths outside the root', () => {
    const root = tmpRoot()
    expect(resolveInRoot(root, '/etc/passwd')).toBeNull()
    expect(resolveInRoot(root, path.join(root, 'ok.md'))).toBe(path.join(root, 'ok.md'))
  })

  it('rejects a sibling whose name merely starts like the root', () => {
    const root = tmpRoot()
    expect(resolveInRoot(root, path.resolve(root + '-evil', 'x'))).toBeNull()
  })

  it('rejects a symlink pointing outside the root', () => {
    const root = tmpRoot()
    const outside = tmpRoot()
    writeFileSync(path.join(outside, 'secret.txt'), 'leak')
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
    expect(resolveInRoot(root, 'link.txt')).toBeNull()

    symlinkSync(outside, path.join(root, 'dir'))
    expect(resolveInRoot(root, 'dir/secret.txt')).toBeNull()
    // Writing through a symlinked directory escapes just as effectively.
    expect(resolveInRoot(root, 'dir/new.txt')).toBeNull()
  })

  it('rejects NUL bytes', () => {
    const root = tmpRoot()
    expect(resolveInRoot(root, 'a\0b')).toBeNull()
  })
})

describe('relativeToRoot', () => {
  it('never reveals the layout above the root', () => {
    const root = '/tmp/runtpt-example'
    expect(relativeToRoot(root, '/tmp/runtpt-example')).toBe('.')
    expect(relativeToRoot(root, '/tmp/runtpt-example/a/b.md')).toBe(path.join('a', 'b.md'))
  })
})
