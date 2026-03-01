We are working in @recipe-lanes/ and I have 'npm run dev' running a version locally on http://localhost:8001/lanes, please use the playwright mcp tools to look around and use the website and the codebase to build some familiarity.
Have a look around the code base and read the README's and other docs to help. If you see docs that are out of date or missing info that would have been helpfull to bring yourself up to speed you should make a PR to add it. 

Have a look at the git history with 'git log --graph --all --color --pretty=format:"%x1b[31m%h%x09%x1b[32m%d%x1b[0m%x20%s"'

Here is a function 'pr_comments' which is helpfull for getting github comments on issues.
function pr_comments() {
    if [ -z "$1" ]; then
        echo "Usage: pr_comments <pr-number>"
        return 1
    fi

    gh api graphql -F owner=':owner' -F repo=':repo' -F number="$1" -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          title
          author { login }
          body
          # 1. General Chat (Issue Comments)
          comments(first: 100) {
            nodes {
              #type: __typename
              author { login }
              body
              #createdAt
            }
          }
          # 2. Reviews & Inline Code Comments
          reviews(first: 50) {
            nodes {
              #type: __typename
              author { login }
              #state
              body # Summary text of the review
              #createdAt
              # Inline comments attached to this review
              comments(first: 50) {
                nodes {
                  #type: __typename
                  path
                  line
                  body
                }
              }
            }
          }
        }
      }
    }'
}


staging pushes to https://staging.recipelanes.com/
main pushes to https://recipelanes.com/
Use playwright MCP tools to view staging and confirm fixes for things.

Your Main job: 
Read _all_ open issues using gh (the cli tool) and decide on one to tackle. You might read further comments and relataed PR's to help you decide.
Work to reproduce using playwright mcp and make a test that reproduces the issue and fails, make a commit at this point (use --no-verify here and only here to bypass the test check which will obviously fail) with prefix 'Test: ..'. Then implement the fix with a commit starting with 'Fix:..'. Then make a pr according to git_workflow.md (read this before starting). If you can't fully reproduce or fix an issue, that's totally okay, leave a comment on the bug saying where you got up to for the next person/agent to help them. Make sure your fix has e2e tests.

 make a staging branch that has a merge of all of your features, push it to staging and verify that it works before you finish, never assume something will work.

 The 2 main test recipes are 'test eggs' optionally add 'with blah' where blah can be anything and will be added as a node. and 'test complex' which makes a more complex graph. Search the codebase under e2e for these phrases to see how they are used and lib/ai-service.ts for how it's implemented.
