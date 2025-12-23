import Link from 'next/link';
import { getPublicGalleryAction } from '@/app/actions';
import { ChefHat, ArrowLeft, Search, Star, User } from 'lucide-react';
import { RecipeCard } from '@/components/ui/recipe-card';
import { getDataService } from '@/lib/data-service';
import { getAuthService } from '@/lib/auth-service';
import { Login } from '@/components/login';

export const dynamic = 'force-dynamic';

export default async function GalleryPage({ searchParams }: { searchParams: { q?: string; filter?: string } }) {
  const query = searchParams.q;
  const filter = searchParams.filter || 'public';
  const session = await getAuthService().verifyAuth();
  
  let recipes = [];

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-yellow-500/30">
      <div className="w-full max-w-7xl mx-auto p-6 space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-zinc-800 pb-6">
            <div className="flex items-center gap-4">
                <Link href="/lanes" className="p-2 rounded-full hover:bg-zinc-900 transition-colors text-zinc-400 hover:text-white">
                    <ArrowLeft className="w-6 h-6" />
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-zinc-100 flex items-center gap-3">
                        <ChefHat className="w-8 h-8 text-yellow-500" />
                        {filter === 'mine' ? 'My Recipes' : filter === 'starred' ? 'Starred Recipes' : 'Community Gallery'}
                    </h1>
                    <p className="text-zinc-500 text-sm mt-1">
                        {filter === 'mine' ? 'Recipes you created' : filter === 'starred' ? 'Your favorites' : 'Explore recipes visualized by the community'}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-4 w-full md:w-auto">
                {/* Search Form (Only for public) */}
                {filter === 'public' && (
                    <form className="relative flex-1 md:w-64 group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-yellow-500 transition-colors" />
                        <input 
                            name="q"
                            defaultValue={query}
                            placeholder="Search recipes..." 
                            className="w-full bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-all placeholder:text-zinc-600"
                        />
                    </form>
                )}

                {session ? (
                    <div className="flex gap-2 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                         <Link href="/gallery" className={`p-2 rounded-md transition-colors ${filter === 'public' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`} title="Public">
                             <ChefHat className="w-4 h-4" />
                         </Link>
                         <Link href="/gallery?filter=mine" className={`p-2 rounded-md transition-colors ${filter === 'mine' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`} title="My Recipes">
                             <User className="w-4 h-4" />
                         </Link>
                         <Link href="/gallery?filter=starred" className={`p-2 rounded-md transition-colors ${filter === 'starred' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`} title="Starred">
                             <Star className="w-4 h-4" />
                         </Link>
                    </div>
                ) : (
                    <Link href="/lanes" className="text-sm text-zinc-400 hover:text-white underline">Login for more</Link>
                )}
            </div>
        </header>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {recipes.map((recipe: any) => (
                <div key={recipe.id} className="h-full">
                    <RecipeCard recipe={recipe} />
                </div>
            ))}
            
            {recipes.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-32 text-zinc-500 space-y-4 border-2 border-dashed border-zinc-800 rounded-xl">
                    <ChefHat className="w-12 h-12 opacity-20" />
                    <p>{query ? `No recipes found for "${query}"` : 'No public recipes found yet.'}</p>
                    <Link href="/lanes" className="text-yellow-500 hover:underline">
                        Create one now!
                    </Link>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}

