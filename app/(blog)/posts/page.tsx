import { getAllPosts } from '@/lib/wordpress';

import { Section, Container, Prose } from '@/components/craft';
import { PostCard } from '@/components/posts/post-card';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog Posts',
  description: 'Browse all our blog posts'
};

export default async function Page() {
  const posts = await getAllPosts();

  return (
    <Section>
      <Container>
        <div className="space-y-8">
          <Prose>
            <h2>All Posts</h2>
            <p className="text-muted-foreground">
              {posts.length} {posts.length === 1 ? 'post' : 'posts'} found
            </p>
          </Prose>

          {posts.length > 0 ? (
            <div className="grid md:grid-cols-3 gap-4">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          ) : (
            <div className="h-24 w-full border rounded-lg bg-accent/25 flex items-center justify-center">
              <p>No posts found</p>
            </div>
          )}
        </div>
      </Container>
    </Section>
  );
}
