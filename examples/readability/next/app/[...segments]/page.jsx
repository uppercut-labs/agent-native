import { notFound } from 'next/navigation';
import model from '../../generated/publication.json';

const lookup = async (params) => {
  const { segments } = await params;
  return model.pages.find((page) => page.route === '/' + segments.join('/')) || notFound();
};
export function generateStaticParams() {
  return model.pages.map((page) => ({ segments: page.route.slice(1).split('/') }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }) {
  const page = await lookup(params);
  return {
    title: page.title,
    alternates: { canonical: page.canonical, types: { 'text/markdown': page.mirror } },
  };
}
export default async function CoursePage({ params }) {
  const page = await lookup(params);
  return (
    <main>
      {page.jsonld && (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON is serialized from the public projection and script terminators are escaped.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(page.jsonld).replaceAll('<', '\\u003c'),
          }}
        />
      )}
      <h1>{page.title}</h1>
      <p>{page.markdown}</p>
      {page.links.map((link) => (
        <p key={link.route}>
          <a href={link.route}>{link.title}</a>
        </p>
      ))}
      {page.id === 'field-recording' && <a href="/lessons/studio-lab">Open your studio lab</a>}
    </main>
  );
}
