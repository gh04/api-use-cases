# Salesforce JotForm Appointment Blockout Manager

Apex classes that let a Salesforce Screen Flow manage blockout dates on JotForm appointment widget questions.

## Components

| File | Purpose |
|---|---|
| `JotFormService.cls` | Core service — HTTP callouts to JotForm API (get questions, get/update blockout dates) |
| `JotFormBlockoutAction.cls` | Invocable action for Flow — fetches appointment questions from a form |
| `JotFormUpdateBlockoutAction.cls` | Invocable action for Flow — pushes updated blockout dates to JotForm |
| `JotFormServiceTest.cls` | Test class with HttpCalloutMock coverage |

## Salesforce Setup

### 1. External Credential + Named Credential

Already configured:
- **External Credential**: `JotForm_External_Credential` (Custom protocol, `APIKEY` header)
- **Named Credential**: `JotForm_API` → `https://api.jotform.com`
- **Principal**: `JotForm_Default` mapped to a Permission Set

### 2. Deploy Classes

Copy the `.cls` and `.cls-meta.xml` files into your org via SFDX, Change Sets, or VS Code.

### 3. Screen Flow Design

The Flow queries `Forms__c` to show only client-specific forms, then uses the invocable actions:

1. **Screen 1**: Pick a form from `Forms__c` (record choice or picklist)
2. **Action**: Call `Get JotForm Appointment Questions` with the `Form_ID__c`
3. **Screen 2**: Display current blockout dates, inputs for new date ranges, checkboxes to remove existing ones
4. **Action**: Call `Update JotForm Blockout Dates` with the merged date list

### Flow Variables

| Variable | Type | Description |
|---|---|---|
| `formId` | Text | The `Form_ID__c` from the selected `Forms__c` record |
| `questionId` | Text | The QID of the appointment widget (from the get action) |
| `appointmentsJson` | Text | JSON array of appointment questions with their blockout dates |
| `blockoutDatesJson` | Text | JSON array of `{startDate, endDate}` objects to push back |
