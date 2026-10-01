public with sharing class JotFormBlockoutAction {

    public class GetAppointmentsRequest {
        @InvocableVariable(required=true label='Form ID')
        public String formId;
    }

    public class GetAppointmentsResult {
        @InvocableVariable(label='Appointment Questions JSON')
        public String appointmentsJson;
        @InvocableVariable(label='Error Message')
        public String errorMessage;
        @InvocableVariable(label='Success')
        public Boolean success;
    }

    @InvocableMethod(label='Get JotForm Appointment Questions' description='Fetches appointment widget questions and their blockout dates from a JotForm form')
    public static List<GetAppointmentsResult> getAppointmentQuestions(List<GetAppointmentsRequest> requests) {
        List<GetAppointmentsResult> results = new List<GetAppointmentsResult>();
        for (GetAppointmentsRequest req : requests) {
            GetAppointmentsResult result = new GetAppointmentsResult();
            try {
                List<JotFormService.AppointmentQuestion> questions =
                    JotFormService.getAppointmentQuestions(req.formId);
                result.appointmentsJson = JSON.serialize(questions);
                result.success = true;
            } catch (Exception e) {
                result.errorMessage = e.getMessage();
                result.success = false;
            }
            results.add(result);
        }
        return results;
    }
}
