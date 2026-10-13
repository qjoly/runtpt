# Finding your way around an unfamiliar repository

You have been handed a repository you did not write and a question about it.
This is the twenty minutes you spend before touching anything.

Every command here only reads. Run them in order — each one narrows the next.

## Before you start

- [ ] You are in the repository you mean to look at
- [ ] You know what question you are trying to answer

## Where am I?

```bash
cd "$(git rev-parse --show-toplevel)" && pwd
```

The rest of this runbook assumes that directory. The next cell runs in the same
shell, so it is still there — that is the point of a runbook rather than a list
of snippets.

```bash
git log -1 --no-show-signature --format='%h %ad %an%n%s' --date=short
```

If the last commit is two years old, stop and ask whether this is really the
code that runs in production.

## How big is the problem?

```bash
echo "commits:     $(git rev-list --count HEAD)"
echo "contributors:$(git log --no-show-signature --format='%an' | sort -u | wc -l)"
echo "tracked files:$(git ls-files | wc -l)"
```

> [!NOTE]
> A repository with three hundred commits and one contributor is somebody's
> side project. Thirty thousand commits and eighty contributors is an
> institution, and your question probably has an owner you can ask.

## What is it written in?

```bash
git ls-files | sed -n 's/.*\.\([a-z0-9]\{1,8\}\)$/\1/p' | sort | uniq -c | sort -rn | head -12
```

Counting extensions beats reading the README, which tends to describe what the
project wanted to be.

## Who touches it, and where?

```bash
git log --since='6 months ago' --no-show-signature --name-only --format='' | grep . | sort | uniq -c | sort -rn | head -15
```

The files that change most are where the work is. They are also where the bugs
are, which is usually the same answer.

`--no-show-signature` is not decoration: some people have `log.showSignature`
turned on globally, and without the flag git mixes signature output into the
lines you are about to count.

<details>
<summary>Nothing came back</summary>

Either the repository has been quiet for six months, or you are on a branch with
no recent history. Check which branch you are on and how far it is from the
default one:

```bash
git branch --show-current
git log --oneline --no-show-signature origin/HEAD..HEAD 2>/dev/null | head
```

</details>

## What is in flight?

```bash
git status --short --branch
```

```bash
git branch -r --sort=-committerdate --format='%(committerdate:short)  %(refname:short)' | head -10
```

Recent branches tell you what people are working on right now, which the commit
log on the default branch will not show you for weeks.

> [!WARNING]
> A dirty working tree in a repository you just cloned means somebody left
> something behind. Find out what it is before you run anything that builds.

## How is it tested?

```bash
git ls-files | grep -iE '(^|/)(test|tests|spec|__tests__)/' | head -10
```

```bash
git ls-files | grep -iE '^\.github/workflows/' | head
```

An empty answer to both is itself an answer, and it should change how confident
you are about the change you were about to make.

## Before you close the tab

- [ ] I know when this was last touched, and by whom
- [ ] I know which files move most
- [ ] I know whether anything tests it

Write down what you found. The next person to open this repository will be you,
having forgotten all of it.
