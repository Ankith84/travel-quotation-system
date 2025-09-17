# DreamScape Journey - AI Quotation System

🤖 **AI-Powered Travel Quotation Generator**

Transform your DMC quotations into professional branded travel packages using AI.

## 🚀 Quick Setup (5 minutes)

### Step 1: Deploy to Vercel
1. Go to [Vercel.com](https://vercel.com)
2. Connect your GitHub account
3. Import this repository
4. Deploy (it's free!)

### Step 2: Add OpenAI API Key
1. Get API key from [OpenAI API Keys](https://platform.openai.com/api-keys)
2. In Vercel dashboard → Project Settings → Environment Variables
3. Add: `OPENAI_API_KEY` = `your_api_key_here`
4. Redeploy

### Step 3: Customize Your Branding
Edit company details in `index.html` around line 200:
```javascript
const companyData = {
    name: "Your Company Name",
    tagline: "Your Tagline",
    address: "Your Address",
    phone: "Your Phone",
    email: "your@email.com",
    website: "yourwebsite.com"
};
