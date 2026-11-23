export const isFormGatePending = user => user?.formGateEnabled === true && user?.registrationFormStatus !== 'verified';
