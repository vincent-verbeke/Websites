import { Component, signal, OnInit, inject, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { EmailService, EmailData } from '../../services/email.service';

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
    subtitle = signal('Contact Vincent Verbeke'); // Default subtitle

    private emailService = inject(EmailService);
    private route = inject(ActivatedRoute);

    ngOnInit() {
        this.route.queryParams.subscribe(params => {
            const source = params['source'];
            this.isConsultation.set(params['consultation'] === 'true');

            if (source === 'HR') {
                this.subtitle.set('Contact Liesbet Mallet');
            } else {
                this.subtitle.set('Contact Vincent Verbeke');
            }
        });
    }

    submitForm() {
        const consultationContext = this.isConsultation() ? '\n[Request for free initial 2h consultation on-site in Switzerland or via Microsoft Teams abroad]\n' : '';
        const emailData: EmailData = {
            to: ['vincent.verbeke@kuroliv.ch', 'liz.mallet@kuroliv.ch'],
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
}
