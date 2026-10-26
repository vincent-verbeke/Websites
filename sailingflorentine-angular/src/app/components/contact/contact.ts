import { Component, signal, OnInit, inject, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmailService, EmailData } from '../../services/email';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="contact-hero">
      <div class="container">
        <h1>Contact The SY Florentine crew</h1>
        <p class="subtitle">We'd love to hear from you, whether it's about sailing, technical gear, or just to say hello.</p>
      </div>
    </section>

    <div class="contact-page">
      <div class="container main-grid">
        <section class="info-section">
          <div class="info-card">
            <h2>Impressum</h2>
            <div class="info-block">
              <h3>KuroLIV GmbH</h3>
              <p>Gesellschaft mit beschränkter Haftung</p>
              <p>Färberstrasse 5</p>
              <p>8832 Wollerau, Switzerland</p>
              <p>Sitz: Wollerau</p>
              <br>
              <p><strong>UID:</strong> CHE-365.727.853</p>
              <p><strong>CH-ID:</strong> CH-130-4030931-0</p>
            </div>
            
            <div class="legal-block">
              <h3>Management</h3>
              <p>
                <strong>Vincent Verbeke</strong><br>
                <span class="role">Captain & Owner</span>
              </p>
              <p>
                <strong>Liesbet (Liz) Mallet</strong><br>
                <span class="role">1st Mate & Strategic Lead</span>
              </p>
            </div>
            
            <div class="contact-links">
              <p>Email: <a href="mailto:info@kuroliv.ch">info@kuroliv.ch</a></p>
            </div>
          </div>
        </section>

        <section class="form-section">
          <div class="form-card">
            <h2>Send us a Message</h2>
            <form (submit)="submitForm(); $event.preventDefault()">
              <div class="form-group">
                <label for="name">Name</label>
                <input type="text" id="name" name="name" [(ngModel)]="name" required placeholder="Your Name">
              </div>
              <div class="form-group">
                <label for="email">Email</label>
                <input type="email" id="email" name="email" [(ngModel)]="email" required placeholder="your.email@example.com">
              </div>
              <div class="form-group">
                <label for="subject">Subject</label>
                <input type="text" id="subject" name="subject" [(ngModel)]="subject" required placeholder="What is this about?">
              </div>
              <div class="form-group">
                <label for="message">Message</label>
                <textarea id="message" name="message" [(ngModel)]="message" required rows="6" placeholder="Your message..."></textarea>
              </div>
              <button type="submit" class="submit-btn" [disabled]="isSubmitting()">
                {{ isSubmitting() ? 'Sending...' : 'Send Message' }}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .contact-hero {
      padding: 8rem 2rem 4rem;
      background: linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7)), url('/images/boat/florentine-deck.jpg');
      background-size: cover;
      background-position: center;
      text-align: center;
      color: white;
      
      h1 { font-size: 3.5rem; margin-bottom: 0.5rem; color: var(--accent-color); }
      .subtitle { font-size: 1.2rem; opacity: 0.9; max-width: 700px; margin: 0 auto; }
    }

    .contact-page {
      padding: 4rem 2rem;
    }

    .container { max-width: 1200px; margin: 0 auto; }

    .main-grid {
      display: grid;
      grid-template-columns: 1fr 1.5fr;
      gap: 3rem;
      align-items: start;
    }

    .info-card, .form-card {
      background: var(--glass-bg);
      backdrop-filter: blur(10px);
      padding: 3rem;
      border-radius: 20px;
      border: 1px solid var(--glass-border);
      color: var(--card-text);
    }

    h2 { font-size: 2rem; margin-bottom: 2rem; color: var(--accent-color); }
    h3 { font-size: 1.2rem; margin-bottom: 1rem; color: inherit; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.5rem; }

    .info-block, .legal-block {
      margin-bottom: 2rem;
      p { margin-bottom: 0.5rem; opacity: 0.8; line-height: 1.6; }
      .role { font-size: 0.9rem; color: var(--secondary-color); font-weight: bold; }
    }

    .form-group {
      margin-bottom: 1.5rem;
      label { display: block; margin-bottom: 0.5rem; font-weight: 500; opacity: 0.9; }
      input, textarea {
        width: 100%;
        padding: 0.8rem 1rem;
        background: var(--input-bg);
        border: 1px solid var(--input-border);
        border-radius: 8px;
        color: var(--input-text);
        font-family: inherit;
        transition: border-color var(--transition-speed);
        
        &:focus { outline: none; border-color: var(--accent-color); }
      }
    }

    .submit-btn {
      width: 100%;
      padding: 1rem;
      background: var(--secondary-color);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1.1rem;
      font-weight: bold;
      cursor: pointer;
      transition: background 0.3s, transform 0.2s;
      
      &:hover:not(:disabled) { background: #005bb5; transform: translateY(-2px); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    @media (max-width: 968px) {
      .main-grid { grid-template-columns: 1fr; }
      .contact-hero h1 { font-size: 2.5rem; }
    }
  `]
})
export class ContactComponent {
  name = model('');
  email = model('');
  subject = model('');
  message = model('');
  isSubmitting = signal(false);

  private emailService = inject(EmailService);

  submitForm() {
    this.isSubmitting.set(true);
    const emailData: EmailData = {
      to: ['vincent.verbeke@kuroliv.ch', 'liz.mallet@kuroliv.ch'],
      subject: `Sailing Florentine Contact: ${this.subject()} (${this.name()})`,
      body_text: `Name: ${this.name()}\nEmail: ${this.email()}\n\nMessage:\n${this.message()}`
    };

    this.emailService.sendEmail(emailData).subscribe({
      next: () => {
        alert('Thank you for your message. We will get back to you soon!');
        this.name.set('');
        this.email.set('');
        this.subject.set('');
        this.message.set('');
        this.isSubmitting.set(false);
      },
      error: (error) => {
        console.error('Error sending email', error);
        alert('There was an error sending your message. Please try again later.');
        this.isSubmitting.set(false);
      }
    });
  }
}
