public with sharing class JotFormUpdateBlockoutAction {

    public class UpdateBlockoutRequest {
        @InvocableVariable(required=true label='Form ID')
        public String formId;
        @InvocableVariable(required=true label='Question ID')
        public String questionId;
        @InvocableVariable(required=true label='Blockout Dates JSON')
        public String blockoutDatesJson;
    }

    public class UpdateBlockoutResult {
        @InvocableVariable(label='Error Message')
        public String errorMessage;
        @InvocableVariable(label='Success')
        public Boolean success;
    }

    @InvocableMethod(label='Update JotForm Blockout Dates' description='Updates blockout dates on a JotForm appointment widget question')
    public static List<UpdateBlockoutResult> updateBlockoutDates(List<UpdateBlockoutRequest> requests) {
        List<UpdateBlockoutResult> results = new List<UpdateBlockoutResult>();
        for (UpdateBlockoutRequest req : requests) {
            UpdateBlockoutResult result = new UpdateBlockoutResult();
            try {
                Map<String, String> properties = new Map<String, String>{
                    'blockoutDates' => req.blockoutDatesJson
                };
                JotFormService.updateQuestionProperties(req.formId, req.questionId, properties);
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
