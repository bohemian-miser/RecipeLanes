import Link from 'next/link';
import { getPublicGalleryAction } from '@/app/actions';
import { ChefHat, Calendar, GitGraph, ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function GalleryPage() {
  const recipes = await getPublicGalleryAction();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-yellow-500/30">
      <div className="w-full max-w-7xl mx-auto p-6 space-y-8">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-800 pb-6">
            <div className="flex items-center gap-4">
                <Link href="/lanes" className="p-2 rounded-full hover:bg-zinc-900 transition-colors text-zinc-400 hover:text-white">
                    <ArrowLeft className="w-6 h-6" />
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-zinc-100 flex items-center gap-3">
                        <ChefHat className="w-8 h-8 text-yellow-500" />
                        Community Gallery
                    </h1>
                    <p className="text-zinc-500 text-sm mt-1">Explore recipes visualized by the community</p>
                </div>
            </div>
            <Link 
                href="/lanes" 
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg transition-colors shadow-lg hover:shadow-yellow-500/20"
            >
                Create New
            </Link>
        </header>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {recipes.map((recipe: any) => (
            <Link key={recipe.id} href={`/lanes?id=${recipe.id}`} className="block group">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-yellow-500/50 hover:shadow-xl hover:shadow-yellow-500/5 transition-all duration-300 h-full flex flex-col">
                {/* Preview Image if available */}
                {recipe.previewIcon ? (
                    <div className="h-40 bg-zinc-950/50 flex items-center justify-center p-6 border-b border-zinc-800/50 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent opacity-50" />
                        <img 
                            src={recipe.previewIcon} 
                            alt="" 
                            className="h-full w-full object-contain drop-shadow-xl group-hover:scale-110 transition-transform duration-500" 
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </div>
                ) : (
                    <div className="h-40 bg-zinc-950/50 flex items-center justify-center p-6 border-b border-zinc-800/50">
                        <ChefHat className="w-12 h-12 text-zinc-800" />
                    </div>
                )}
                
                <div className="p-5 flex-1 flex flex-col">
                    <h3 className="font-bold text-lg mb-3 text-zinc-200 group-hover:text-yellow-500 transition-colors line-clamp-2 leading-tight">
                        {recipe.title}
                    </h3>
                    <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono mt-auto pt-4 border-t border-zinc-800/50">
                        <div className="flex items-center gap-1.5" title="Created At">
                            <Calendar className="w-3 h-3" />
                            {recipe.createdAt ? new Date(recipe.createdAt).toLocaleDateString() : 'Unknown'}
                        </div>
                        <div className="flex items-center gap-1.5 ml-auto" title="Steps">
                            <GitGraph className="w-3 h-3" />
                            {recipe.nodeCount}
                        </div>
                    </div>
                </div>
                </div>
            </Link>
            ))}
            {recipes.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-32 text-zinc-500 space-y-4 border-2 border-dashed border-zinc-800 rounded-xl">
                    <ChefHat className="w-12 h-12 opacity-20" />
                    <p>No public recipes found yet.</p>
                    <Link href="/lanes" className="text-yellow-500 hover:underline">
                        Be the first to create one!
                    </Link>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
