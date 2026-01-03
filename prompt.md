We are working in @recipe-rpg-simple/ and I have 'npm run dev' running a version locally on http://localhost:8001/lanes, please use the playwright mcp tools to look around and use the website and the codebase to build some familiarity.
Have a look around the code base and read the README's and other docs to help. If you see docs that are out of date or missing info that would have been helpfull to bring yourself up to speed you should make a PR to add it. (Use --no-verify iff you are updating docs or adding a new test, otherwise the tests will run and slow you down or block you since you haven't written the fix yet)

Have a look at the git history with the helper from bash.rc 'glog', there's also 'pr_comments' which is helpfull for getting github comments on issues.
alias glog='git log --graph --all --color --pretty=format:"%x1b[31m%h%x09%x1b[32m%d%x1b[0m%x20%s"'

staging pushes to https://skipping-down--recipe-lanes-staging.asia-southeast1.hosted.app/
main pushes to https://skipping-down--recipe-lanes.asia-southeast1.hosted.app/
Use playwright MCP tools to view staging and confirm fixes for things.

Your Main job: 
for each open issue in github (use 'gh' cli), read the comments and what's happened and if you think you can fix it then work to reproduce using playwright mcp and make a test that reproduces the issue and fails, make a commit at this point (use --no-verify here and only here to bypass the test check which will obviously fail) with prefix 'Test: ..'. Then implement the fix with a commit starting with 'Fix:..'. Then make a pr according to git_workflow.md (read this before starting). If you can't fully reproduce or fix an issue, that's totally okay, leave a comment on the bug saying where you got up to for the next person/agent to help them. Make sure your fix has e2e tests.

 make a staging branch that has a merge of all of your features, push it to staging and verify that it works before you finish, never assume something will work.

 The 2 main test recipes are 'test eggs' optionally add 'with blah' where blah can be anything and will be added as a node. and 'test complex' which makes a more complex graph. Search the codebase under e2e for these phrases to see how they are used and lib/ai-service.ts for how it's implemented.
