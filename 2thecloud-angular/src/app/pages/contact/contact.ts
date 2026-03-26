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

    private emailService = inject(EmailService);
    private route = inject(ActivatedRoute);

    ngOnInit() {
        this.route.queryParams.subscribe(params => {
            this.isConsultation.set(params['consultation'] === 'true');
            const source = params['source'];
            const subject = params['subject'];

            if (subject) {
                this.subject.set(subject);
            } else if (this.isConsultation()) {
                this.subject.set(source === 'modernization' ? 'App Modernization Audit Request' : 'Infrastructure Audit Request');
            }
        });
    }

    submitForm() {
        const consultationContext = this.isConsultation() ? '\n[Request for free initial 2h consultation on-site in Switzerland or via Microsoft Teams abroad]\n' : '';
        const emailData: EmailData = {
            to: ['vincent.verbeke@kuroliv.ch'],
            subject: `2TheCloud Journey: ${this.subject()} (${this.name()})`,
            body_text: `Name: ${this.name()}\nEmail: ${this.email()}\nPhone: ${this.phone()}${consultationContext}\n\nMessage:\n${this.message()}`
        };

        this.emailService.sendEmail(emailData).subscribe({
            next: (response) => {
                alert('Thank you for starting your cloud journey with us. We will get back to you soon!');
                this.resetForm();
            },
            error: (error) => {
                console.error('Error sending email', error);
                alert('There was an error. Please try again or email us directly.');
            }
        });
    }

    private resetForm() {
        this.name.set('');
        this.email.set('');
        this.phone.set('');
        this.subject.set('');
        this.message.set('');
    }
}
