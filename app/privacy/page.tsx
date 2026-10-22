import "./privacy.css";

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <article className="privacy-card">
        <header className="privacy-header">
          <a href="/signin" aria-label="Whittaker Geo sign-in">
            <img src="/whittaker-geo-logo.png" alt="Whittaker Geo" width="240" height="80" />
          </a>
          <a className="btn ghost" href="/signin">← Back to sign in</a>
        </header>
        <p className="eyebrow">Whittaker Geoscience</p>
        <h1>Privacy policy</h1>
        <p className="privacy-updated">Last updated: October 22, 2026</p>
        <p>Whittaker Geoscience operates Whittaker Geo, an application for project economics and saved calculation scenarios. This notice describes how information is used when you sign in and use the application.</p>

        <h2>Account and sign-in information</h2>
        <p>When you sign in with Google, the application receives basic account information such as your email address, name, and profile picture. We use this information to authenticate you, identify your account, and display your profile. Whittaker Geo does not request access to your Gmail messages, Google Drive files, or contacts. Email-link sign-in uses the email address you provide.</p>

        <h2>Calculation and project information</h2>
        <p>The application processes the project names, model inputs, and other information you enter to calculate results and provide your workspace. Saved projects, calculation runs, results, and exports are associated with your account. Administrators can also upload calculation models.</p>
        <p>Unsaved drafts can be stored in your browser’s session storage so they can be restored after a page reload. When live calculation is enabled, inputs are sent to the calculation service to update results, even before you save a project.</p>

        <h2>How information is used</h2>
        <p>We use this information to provide sign-in, manage account access, perform calculations, save and retrieve your work, generate exports, and investigate service or security problems. Saved calculations are not published as public pages. Account ownership checks limit which saved projects a signed-in user can access.</p>

        <h2>Service providers</h2>
        <p>Google provides Google sign-in and may serve profile images and fonts used by the application. Supabase provides authentication, database, and file-storage services. Cloudflare hosts and protects the website. Enabled calculation services may run on Render. These providers process information needed for their roles, including connection, authentication, and diagnostic information. Service operators may access information when needed to operate, support, or secure the application.</p>
        <p>The providers’ own privacy information is available from <a href="https://policies.google.com/privacy">Google</a>, <a href="https://supabase.com/privacy">Supabase</a>, <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare</a>, and <a href="https://render.com/privacy">Render</a>.</p>

        <h2>Browser storage and saved records</h2>
        <p>The application uses authentication cookies and browser storage to maintain sign-in and restore session drafts. Blocking or clearing that storage can sign you out or remove unsaved drafts. Saved project records and run history are kept to let you reopen your work. Contact us about account information, corrections, or requests to remove an account or its data.</p>

        <h2>Contact</h2>
        <p>For questions about this notice or your information in Whittaker Geo, contact Whittaker Geoscience at <a href="mailto:info@whittakergeo.com">info@whittakergeo.com</a>.</p>
      </article>
    </main>
  );
}
