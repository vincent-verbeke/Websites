import { Component, signal, OnInit, inject, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EmailService, EmailData } from '../../services/email.service';
import { ThemeService } from '../../services/theme';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contact.html',
  styleUrl: './contact.scss'
})
export class Contact implements OnInit {
  name = model('');
  email = model('');
  phone = model('');
  subject = model('');
  message = model('');
  isConsultation = signal(false);
  subtitle = signal('Contact Us');

  private emailService = inject(EmailService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // Get current language from URL or default to 'en'
  language = signal('en');

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const source = params['source'];
      const lang = params['lang'] || 'en';
      this.language.set(lang);
      this.isConsultation.set(params['consultation'] === 'true');

      if (source === 'HR') {
        this.subtitle.set('Contact Liesbet Mallet');
      } else {
        this.subtitle.set('Contact Us');
      }
    });

    // Update subtitle based on language
    this.updateSubtitleForLanguage();
  }

  updateSubtitleForLanguage() {
    const lang = this.language();
    if (lang === 'nl') {
      this.subtitle.set('Neem contact op'); // Dutch
    } else if (lang === 'de') {
      this.subtitle.set('Kontaktieren Sie uns'); // German
    } else {
      this.subtitle.set('Contact Us'); // English
    }
  }

  submitForm() {
    const consultationContext = this.isConsultation() ? '\n[Request for free initial 2h consultation on-site in Switzerland or via Microsoft Teams abroad]\n' : '';
    const emailData: EmailData = {
      to: ['info@angerik.ch', 'info@angerik.be'],
      subject: `Contact Form: ${this.subject()} (${this.name()})`,
      body_text: `Name: ${this.name()}\nEmail: ${this.email()}\nPhone: ${this.phone()}${consultationContext}\n\nMessage:\n${this.message()}`
    };

    this.emailService.sendEmail(emailData).subscribe({
      next: (response) => {
        console.log('Email sent successfully', response);
        alert('Thank you for your message. We will get back to you soon!');
        // Reset form
        this.name.set('');
        this.email.set('');
        this.phone.set('');
        this.subject.set('');
        this.message.set('');
      },
      error: (error) => {
        console.error('Error sending email', error);
        alert('There was an error sending your message. Please try again later or contact us directly via email.');
      }
    });
  }

  getContactInfo() {
    const lang = this.language();
    if (lang === 'nl') {
      // Dutch -> Belgian contact
      return {
        title: 'Brouwerij Angerik',
        subtitle: 'Artisanaal bier in het Pajottenland',
        address: 'Snakkaertstraat 30',
        city: 'B-1700 Dilbeek, Belgium',
        email: 'info@angerik.be',
        phone: '+32 477 37 15 86',
        website: 'www.angerik.be'
      };
    } else {
      // German/English -> Swiss contact
      return {
        title: 'Brauerei Angerik',
        subtitle: 'Artisanal gebrautes Bier aus Belgien',
        address: 'Snakkaertstraat 30',
        city: 'B-1700 Dilbeek, Belgium',
        email: 'info@angerik.ch',
        phone: '+41 79 748 19 75',
        website: 'www.angerik.ch'
      };
    }
  }

  getContactLabel() {
    const lang = this.language();
    if (lang === 'nl') return 'Contact';
    if (lang === 'de') return 'Kontakt';
    return 'Contact';
  }
}
