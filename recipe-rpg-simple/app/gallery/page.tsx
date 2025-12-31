import Link from 'next/link';
import { getPublicGalleryAction } from '@/app/actions';
import { ChefHat, ArrowLeft, Search, Star, User, Plus, Globe } from 'lucide-react';
import { RecipeCard } from '@/components/ui/recipe-card';
import { getDataService } from '@/lib/data-service';
import { getAuthService } from '@/lib/auth-service';
import { Login } from '@/components/login';
import { LoginButton } from '@/components/login-button';
import { LogoutButton } from '@/components/logout-button';

export const dynamic = 'force-dynamic';

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const { q: query, filter: rawFilter } = await searchParams;
  const filter = rawFilter || 'public';
  const session = await getAuthService().verifyAuth();
  
  let recipes = [];
  let errorMsg = null;

  try {
      if (filter === 'mine') {
          if (!session) return <Login />;
          recipes = await getDataService().getUserRecipes(session.uid);
      } else if (filter === 'starred') {
          if (!session) return <Login />;
          recipes = await getDataService().getStarredRecipes(session.uid);
      } else if (query) {
          recipes = await getDataService().searchPublicRecipes(query);
      } else {
          recipes = await getPublicGalleryAction();
      }
  } catch (e: any) {
      console.error('Gallery Fetch Error:', e);
      errorMsg = e.message;
      if (e.message?.includes('index')) {
          errorMsg = "Database index building... please wait a few minutes.";
      }
  }

  // Common Nav Item Styles (matching lanes/page.tsx)
  const navItemClass = "flex items-center gap-2 px-3 py-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors text-xs font-medium";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-yellow-500/30 flex flex-col">
        {/* Consistent Top Bar */}
        <header className="h-14 shrink-0 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-950 z-20 sticky top-0">
            <div className="flex items-center gap-4 overflow-hidden">
                <div className="flex items-center gap-2 shrink-0">
                    <ChefHat className="w-6 h-6 text-yellow-500" />
                    <span className="hidden md:inline font-bold text-lg text-zinc-100 tracking-tight">Recipe Lanes</span>
                </div>
                
                <Link href="/lanes" className="flex items-center gap-2 text-xs font-mono text-zinc-400 hover:text-white transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    <span className="hidden md:inline">Editor</span>
                </Link>
            </div>
            
            <div className="flex items-center gap-2">
                {/* Navigation Tabs */}
                <Link href="/gallery" className={`${navItemClass} ${filter === 'public' ? 'text-white bg-zinc-800' : ''}`} title="Public Gallery">
                    <Globe className="w-4 h-4" />
                    <span className="hidden md:inline">Public</span>
                </Link>
                <Link href="/gallery?filter=mine" className={`${navItemClass} ${filter === 'mine' ? 'text-white bg-zinc-800' : ''}`} title="My Recipes">
                    <User className="w-4 h-4" />
                    <span className="hidden md:inline">Mine</span>
                </Link>
                <Link href="/gallery?filter=starred" className={`${navItemClass} ${filter === 'starred' ? 'text-white bg-zinc-800' : ''}`} title="Starred">
                    <Star className="w-4 h-4" />
                    <span className="hidden md:inline">Starred</span>
                </Link>
                <Link href="/lanes?new=true" className={navItemClass} title="Create New">
                    <Plus className="w-4 h-4" />
                    <span className="hidden md:inline">New</span>
                </Link>

                <div className="h-4 w-px bg-zinc-800 mx-2" />

                <div className="text-[10px] font-mono text-zinc-600 shrink-0 flex items-center gap-3">
                    {session ? (
                        <>
                            <span className="truncate max-w-[150px] hidden sm:block" title={session.name || 'User'}>
                                {session.name || 'User'}
                            </span>
                            <LogoutButton className="hover:text-red-400" />
                        </>
                    ) : (
                        <LoginButton text="Login" className="hover:text-yellow-500 whitespace-nowrap" />
                    )}
                </div>
            </div>
        </header>

      <div className="w-full max-w-7xl mx-auto p-6 space-y-8 flex-1">
        
        {/* Page Header (Title, Search) - Filters moved to top bar */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-zinc-800 pb-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-100 flex items-center gap-3">
                    {filter === 'mine' ? 'My Recipes' : filter === 'starred' ? 'Starred Recipes' : 'Community Gallery'}
                </h1>
                <p className="text-zinc-500 text-sm mt-1">
                    {filter === 'mine' ? 'Recipes you created' : filter === 'starred' ? 'Your favorites' : 'Explore recipes visualized by the community'}
                </p>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                {/* Search Form (Only for public) */}
                {filter === 'public' && (
                    <form className="relative flex-1 md:w-64 group w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-yellow-500 transition-colors" />
                        <input 
                            name="q"
                            defaultValue={query}
                            placeholder="Search recipes..." 
                            className="w-full bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-all placeholder:text-zinc-600"
                        />
                    </form>
                )}
            </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {recipes.map((recipe: any) => (
                <div key={recipe.id} className="h-full">
                    <RecipeCard recipe={recipe} userId={session?.uid} />
                </div>
            ))}
            
            {recipes.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-32 text-zinc-500 space-y-4 border-2 border-dashed border-zinc-800 rounded-xl">
                    <ChefHat className="w-12 h-12 opacity-20" />
                    <p>{errorMsg ? `Error: ${errorMsg}` : query ? `No recipes found for "${query}"` : 'No recipes found.'}</p>
                    <Link href="/lanes?new=true" className="text-yellow-500 hover:underline">
                        Create one now!
                    </Link>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}

